// Guest Web Player (Part II FR-4.2 / Section 6.2.2): zero-install pages under /web/*, server-rendered so every
// data-testid exists on first paint; web/app.js adds live updates, guest cart, chat and progressive sign-in.
const express = require('express');
const path = require('path');
const { pool } = require('./db');
const { wrap } = require('./util');
const { scoreView } = require('./domain/events');
const { getSession } = require('./domain/costream');
const { TEAM_NAMES } = require('./demo');
const { crestColor, initials } = require('./web/crest');

const r = express.Router();
r.use('/assets', express.static(path.join(__dirname, 'web'), { maxAge: '1h' }));
r.get('/vendor/hls.min.js', (req, res) => res.sendFile(require.resolve('hls.js/dist/hls.min.js')));

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

async function nameOf(id) {
  if (TEAM_NAMES[id]) return TEAM_NAMES[id];
  const c = await pool.query('SELECT data FROM clubs WHERE id = $1', [id]);
  return c.rowCount ? c.rows[0].data.name : id;
}

async function streamPathFor(clubIds) {
  const s = await pool.query(`SELECT sk.stream_key FROM stream_keys sk JOIN club_players cp ON cp.id = sk.player_id
    WHERE sk.status = 'active' AND cp.club_id = ANY($1) ORDER BY sk.n DESC LIMIT 1`, [clubIds]);
  return s.rowCount ? `live/${s.rows[0].stream_key}` : null;
}

const crest = (id, name) => `<span class="crest" style="background:${crestColor(id)}" aria-hidden="true">${esc(initials(name))}</span>`;

function page({ title, body, data }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#050913">
<title>${esc(title)} · League Ops</title>
<link rel="stylesheet" href="/web/assets/app.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <span class="brand">LEAGUE OPS</span>
  <span class="who" id="who" role="status" aria-live="polite">Watching as guest</span>
</header>
<main id="main">
${body}
</main>
<script>window.__PAGE__ = ${json(data)};</script>
<script src="/web/vendor/hls.min.js" defer></script>
<script src="/web/assets/app.js" defer></script>
</body>
</html>`;
}

function notFound(res, what) {
  res.status(404).send(page({ title: 'Not found', data: { view: 'none' },
    body: `<section class="card notice"><h1>Not found</h1><p>We couldn't find that ${esc(what)}. The link may be old.</p></section>` }));
}

function openInApp(entityId) {
  return `<a class="btn btn-ghost openapp" href="nascon://entity/${esc(entityId)}">Open in the League Ops app</a>`;
}

// The 9 mandatory data-testid elements for live match and co-stream pages.
function livePlayer({ home, away, statusLabel, room, label }) {
  return `
<section class="hero" aria-label="${esc(label)}">
  <p class="kicker">${esc(statusLabel)}</p>
  <div class="teams">
    <div class="team">${crest(home.id, home.name)}<span>${esc(home.name)}</span></div>
    <span data-testid="live-score-banner" id="score" class="score" role="status" aria-live="polite" aria-label="Live score">${home.score} - ${away.score}</span>
    <div class="team">${crest(away.id, away.name)}<span>${esc(away.name)}</span></div>
  </div>
</section>
<section aria-label="Video">
  <div data-testid="guest-video-player" id="player" class="video" role="region" aria-label="Live video player">
    <video id="video" controls playsinline muted aria-label="Live match video stream"></video>
    <div class="overlay" aria-hidden="true">
      <span class="ov-score" id="ovscore">${esc(home.name)} ${home.score} - ${away.score} ${esc(away.name)}</span>
      <span class="ov-merch">Jersey · PKR 4500</span>
    </div>
    <p class="video-note" id="videonote" role="status">Waiting for the broadcaster to go live…</p>
  </div>
</section>
<section class="grid2">
  <div data-testid="pinned-merch-card" class="card merch" aria-labelledby="merch-title">
    <img src="/web/assets/jersey.png" alt="Alpha United home jersey, blue with gold trim" width="96" height="96">
    <div class="merch-body">
      <h2 id="merch-title">Alpha United Home Jersey</h2>
      <p class="price">PKR 4500.00 · Size L</p>
      <button data-testid="add-to-guest-cart-btn" id="addcart" class="btn btn-accent" type="button">Add to cart</button>
      <p class="cart">In your cart: <span data-testid="guest-cart-count" id="cartcount">0</span> item(s)</p>
      <button id="checkout" class="btn btn-ghost" type="button">Proceed to checkout</button>
      <p id="cartmsg" class="msg" role="status" aria-live="polite"></p>
    </div>
  </div>
  <div class="card chat" aria-labelledby="chat-title">
    <h2 id="chat-title">Live chat</h2>
    <ul data-testid="chat-message-list" id="chatlist" class="chatlist" role="log" aria-live="polite" aria-label="Chat messages"></ul>
    <form id="chatform" class="chatform" data-room="${esc(room)}">
      <label for="chatinput" class="sr-only">Chat message</label>
      <input data-testid="chat-input-field" id="chatinput" type="text" maxlength="300" placeholder="Say something…" autocomplete="off">
      <button data-testid="chat-send-btn" id="chatsend" class="btn btn-primary" type="submit">Send</button>
    </form>
  </div>
</section>
<div data-testid="progressive-auth-modal" id="authmodal" class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-title" hidden>
  <div class="modal-card">
    <h2 id="auth-title">Sign in to continue</h2>
    <p id="authwhy">Sign in to chat and check out. Your cart is kept.</p>
    <form id="authform">
      <label for="authemail">Email</label>
      <input id="authemail" type="email" autocomplete="username" required>
      <label for="authpass">Password</label>
      <input id="authpass" type="password" autocomplete="current-password" required>
      <p id="autherr" class="msg err" role="alert"></p>
      <button class="btn btn-primary" type="submit">Sign in</button>
      <button class="btn btn-ghost" type="button" id="authcancel">Not now</button>
    </form>
    <p class="hint">You'll come back to the same moment in the stream.</p>
  </div>
</div>`;
}

r.get('/matches/:id/:view', wrap(async (req, res) => {
  let s;
  try { s = await scoreView(req.params.id); } catch (e) { return notFound(res, 'match'); }
  const home = { id: s.home.team_id, name: await nameOf(s.home.team_id), score: s.home.score };
  const away = { id: s.away.team_id, name: await nameOf(s.away.team_id), score: s.away.score };
  const data = { view: req.params.view, match_id: s.match_id, status: s.status, home, away, room: `chat-${s.match_id}`,
    stream_path: await streamPathFor([home.id, away.id]) };
  const title = `${home.name} v ${away.name}`;
  let body;
  if (req.params.view === 'live') {
    body = livePlayer({ home, away, statusLabel: s.status === 'in_progress' ? '● LIVE' : s.status.replace('_', ' ').toUpperCase(), room: data.room, label: title });
  } else if (req.params.view === 'notice') {
    const state = String(req.query.state || s.status);
    body = `<section class="card notice"><p class="kicker">MATCH ${esc(state.toUpperCase())}</p><h1>${esc(title)}</h1>
      <p>This match has been ${esc(state)}. We'll update this page automatically when there's news.</p>${openInApp(s.match_id)}</section>`;
  } else {
    const label = req.params.view === 'vod' ? 'FULL TIME · REPLAY' : 'COMING UP';
    body = `<section class="hero"><p class="kicker">${label}</p><div class="teams">
      <div class="team">${crest(home.id, home.name)}<span>${esc(home.name)}</span></div>
      <span class="score" id="score" role="status" aria-label="Score">${req.params.view === 'vod' ? `${home.score} - ${away.score}` : 'vs'}</span>
      <div class="team">${crest(away.id, away.name)}<span>${esc(away.name)}</span></div></div></section>
      <section class="card notice"><p>${req.params.view === 'vod' ? 'The replay will appear here once it has been processed.' : 'The live stream starts at kick-off. Keep this page open — it switches to live automatically.'}</p>${openInApp(s.match_id)}</section>`;
  }
  res.send(page({ title, body, data }));
}));

r.get('/costream/:id', wrap(async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return notFound(res, 'co-stream');
  const matchId = String(req.query.match || 'match-m1');
  let s;
  try { s = await scoreView(matchId); } catch (e) { s = { home: { team_id: '-', score: 0 }, away: { team_id: '-', score: 0 }, match_id: matchId }; }
  const home = { id: s.home.team_id, name: await nameOf(s.home.team_id), score: s.home.score };
  const away = { id: s.away.team_id, name: await nameOf(s.away.team_id), score: s.away.score };
  const data = { view: 'costream', session_id: session.session_id, match_id: s.match_id, home, away, room: session.chat_room_id,
    stream_path: session.status === 'active' ? `costream/${session.session_id}` : null, layout: session.layout,
    participants: session.active_participants, active_host: session.active_host };
  const label = `Co-stream ${session.session_id} · ${session.layout.replace('_', ' ')} · host ${session.active_host || 'none'}`;
  res.send(page({ title: `Co-stream ${session.session_id}`, data,
    body: livePlayer({ home, away, statusLabel: session.status === 'active' ? `● LIVE CO-STREAM · ${session.participant_count} BROADCASTERS` : 'CO-STREAM ENDED', room: data.room, label }) }));
}));

r.get('/players/:id', wrap(async (req, res) => {
  const p = await pool.query('SELECT * FROM club_players WHERE id = $1', [req.params.id]);
  if (!p.rowCount) return notFound(res, 'athlete');
  const row = p.rows[0];
  const club = await nameOf(row.club_id);
  res.send(page({ title: row.data.name, data: { view: 'player' }, body: `<section class="hero">${crest(row.id, row.data.name)}
    <h1>${esc(row.data.name)}</h1><p class="kicker">${esc((row.data.position || '').toUpperCase())} · ${esc(club)}</p>
    ${row.data.bio ? `<p>${esc(row.data.bio)}</p>` : ''}${openInApp(row.id)}</section>` }));
}));

r.get('/clubs/:id', wrap(async (req, res) => {
  const c = await pool.query('SELECT * FROM clubs WHERE id = $1', [req.params.id]);
  if (!c.rowCount) return notFound(res, 'club');
  const club = c.rows[0].data;
  res.send(page({ title: club.name, data: { view: 'club' }, body: `<section class="hero">${crest(c.rows[0].id, club.name)}
    <h1>${esc(club.name)}</h1><p class="kicker">HOME: ${esc(club.venue.name)}</p>${openInApp(c.rows[0].id)}</section>` }));
}));

module.exports = r;
