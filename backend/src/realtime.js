// Realtime layer: a minimal, dependency-free WebSocket server (RFC 6455, server -> client text frames).
// Clients connect to ws://host:8080/ws and receive every domain event as {"type": ..., "data": {...}}.
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

function frame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

function attach(server) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!req.url.startsWith('/ws') || !key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    clients.add(socket);
    socket.setKeepAlive(true);
    socket.on('data', (buf) => {
      // Only control frames matter here: close (0x8) -> close, ping (0x9) -> pong.
      const op = buf[0] & 0x0f;
      if (op === 0x8) socket.end(Buffer.from([0x88, 0]));
      else if (op === 0x9) socket.write(Buffer.from([0x8a, 0]));
    });
    const drop = () => clients.delete(socket);
    socket.on('close', drop);
    socket.on('error', drop);
    socket.write(frame(JSON.stringify({ type: 'hello', data: {} })));
  });
}

function broadcast(type, data) {
  if (!clients.size) return;
  const f = frame(JSON.stringify({ type, data }));
  for (const s of clients) { try { s.write(f); } catch (_) { clients.delete(s); } }
}

module.exports = { attach, broadcast, frame };
