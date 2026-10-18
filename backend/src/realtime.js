// Realtime layer: dependency-free WebSocket server (RFC 6455, server -> client text frames) plus SSE.
// ws://host:8080/ws               -> every domain event (mobile app)
// ws://host:8080/ws/matches/{id}  -> only that match's events (NFR-1 score latency)
// ws://host:8080/ws/chat/{room}   -> only that chat room's messages
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Map();
const sseClients = new Set();

function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

function filterFor(pathname) {
  if (pathname === '/ws' || pathname === '/ws/') return {};
  const m = /^\/ws\/matches\/([^/]+)\/?$/.exec(pathname);
  if (m) return { matchId: decodeURIComponent(m[1]) };
  const c = /^\/ws\/chat\/([^/]+)\/?$/.exec(pathname);
  if (c) return { room: decodeURIComponent(c[1]) };
  const s = /^\/ws\/costream\/([^/]+)\/?$/.exec(pathname);
  if (s) return { session: decodeURIComponent(s[1]) };
  return null;
}

// Broadcaster presence on /ws/costream/{id}?access_token=<JWT>: the server pings every 300 ms, and a broadcaster that
// goes silent for 900 ms (or whose TCP connection drops) is treated as an abrupt disconnect -> host handoff < 1.5 s.
const PRESENCE_PING_MS = 300;
const PRESENCE_TIMEOUT_MS = 900;

function attach(server) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const url = new URL(req.url, 'http://localhost');
    const filter = filterFor(url.pathname);
    if (!filter || !key) { socket.destroy(); return; }
    if (filter.session && url.searchParams.has('access_token')) {
      try {
        const claims = require('./auth').verifyJwt(url.searchParams.get('access_token'));
        if (claims.player_id) filter.presence = claims.player_id;
      } catch (e) { socket.destroy(); return; }
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    socket.setKeepAlive(true);
    clients.set(socket, filter);
    let lastSeen = Date.now();
    socket.on('data', (buf) => {
      lastSeen = Date.now();
      const op = buf[0] & 0x0f;
      if (op === 0x8) socket.end(Buffer.from([0x88, 0]));
      else if (op === 0x9) socket.write(Buffer.from([0x8a, 0]));
    });
    const beat = filter.presence ? setInterval(() => {
      if (Date.now() - lastSeen > PRESENCE_TIMEOUT_MS) socket.destroy();
      else socket.write(Buffer.from([0x89, 0]));
    }, PRESENCE_PING_MS) : null;
    const drop = () => {
      if (!clients.delete(socket)) return;
      if (beat) clearInterval(beat);
      if (!filter.presence) return;
      const stillHere = [...clients.values()].some((f) => f.session === filter.session && f.presence === filter.presence);
      if (!stillHere) {
        require('./domain/costream').presenceLost(filter.session, filter.presence)
          .catch((e) => console.error('presence handoff failed', e.message));
      }
    };
    socket.on('close', drop);
    socket.on('error', drop);
    if (!filter.matchId && !filter.room && !filter.session) socket.write(frame(JSON.stringify({ type: 'hello', data: {} })));
  });
}

const wants = (f, data) => (!f.matchId || data.match_id === f.matchId) && (!f.room || data.chat_room_id === f.room)
  && (!f.session || data.session_id === f.session);

// Server-Sent Events alternative: GET /api/v1/matches/{id}/stream
function sse(req, res, filter) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  const client = { res, filter };
  sseClients.add(client);
  const beat = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => { clearInterval(beat); sseClients.delete(client); });
}

function broadcast(type, data) {
  const json = JSON.stringify({ type, data });
  let f = null;
  for (const [s, filter] of clients) {
    if (!wants(filter, data)) continue;
    f = f || frame(json);
    try { s.write(f); } catch (_) { clients.delete(s); }
  }
  for (const c of sseClients) if (wants(c.filter, data)) c.res.write(`event: ${type}\ndata: ${json}\n\n`);
}

const connectionCount = () => clients.size + sseClients.size;

module.exports = { attach, broadcast, frame, connectionCount, sse };
