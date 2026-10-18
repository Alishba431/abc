// Synchronous pre-broadcast chat moderation (FR-5.3, Section 5.8) with idempotent kick/mute state per room.
const crypto = require('crypto');
const { pool } = require('../db');
const { err, validation } = require('../errors');
const { signDay2 } = require('../sign');
const { withLock } = require('../util');
const { isObj } = require('../validate');
const { publish } = require('../queue');
const cache = require('../cache');
const dlq = require('./dlq');

const DICTIONARY = ['badword', 'porn', 'scam', 'fuck', 'shit', 'bitch', 'asshole', 'idiotspam'];
const LEET = { '@': 'a', 0: 'o', 1: 'i', '!': 'i', 3: 'e', $: 's' };
const SEPARATORS = /[_.\-*​-‍⁠﻿]/g;

// Two readings of a token: "!" as the letter i (sh!t) and "!" as noise (s!c@m, scam!).
function normalisations(token) {
  const base = token.toLowerCase().replace(SEPARATORS, '');
  const read = (s) => [...s].map((ch) => LEET[ch] || ch).join('').replace(/[^a-z0-9]/g, '');
  return [read(base), read(base.replace(/!/g, ''))];
}

function isProfane(token) {
  return normalisations(token).some((w) => DICTIONARY.includes(w) || (w.endsWith('s') && DICTIONARY.includes(w.slice(0, -1))));
}

function maskProfanity(text) {
  let hit = false;
  const masked = text.split(/(\s+)/).map((part) => {
    if (!part || /^\s+$/.test(part) || !isProfane(part)) return part;
    hit = true;
    return '***';
  }).join('');
  return { text: masked, hit };
}

// >= 4 identical characters in a row (case-insensitive) or >= 3 ! / ? in a row.
const isFlood = (text) => /(.)\1{3,}/iu.test(text) || /[!?]{3,}/.test(text);

const rooms = new Map();
cache.onInvalidate((key) => { if (key === null) rooms.clear(); });

function room(id) {
  if (!rooms.has(id)) rooms.set(id, { kicked: [], muted: [], seq: 0, recent: [], posts: new Map() });
  return rooms.get(id);
}
const addOnce = (list, user) => { if (!list.includes(user)) list.push(user); };

function persist(roomId, r, msg) {
  const jobs = [pool.query(`INSERT INTO chat_rooms(room_id, kicked, muted, seq) VALUES ($1,$2,$3,$4)
    ON CONFLICT (room_id) DO UPDATE SET kicked = EXCLUDED.kicked, muted = EXCLUDED.muted, seq = EXCLUDED.seq`,
  [roomId, JSON.stringify(r.kicked), JSON.stringify(r.muted), r.seq])];
  if (msg) {
    jobs.push(pool.query(`INSERT INTO chat_messages(room_id, seq, message_id, sender, text, flagged, reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [roomId, msg.seq, msg.message_id, msg.sender, msg.text, msg.flagged, msg.reason]));
  }
  Promise.all(jobs).catch((e) => console.error('chat persist failed', e.message));
}

// Applies the rules to one message and returns what (if anything) is broadcast to viewers.
function moderateOne(roomId, r, m) {
  const flood = isFlood(m.text);
  const { text, hit } = maskProfanity(m.text);
  if (hit) addOnce(r.kicked, m.sender);
  if (flood) {
    addOnce(r.muted, m.sender);
    persist(roomId, r, null);
    return { flagged: true, dropped: true, reason: 'flood_character_repeat' };
  }
  const out = { message_id: m.message_id, sender: m.sender, text: hit ? text : m.text, flagged: hit, reason: hit ? 'profanity_leetspeak' : null };
  r.seq += 1;
  const stored = { ...out, seq: r.seq, chat_room_id: roomId, at: new Date().toISOString() };
  r.recent.push(stored);
  if (r.recent.length > 100) r.recent.shift();
  persist(roomId, r, stored);
  publish('chat.message', stored);
  return { flagged: hit, dropped: false, message: out };
}

function validateTest(b) {
  const bad = [];
  if (!isObj(b)) throw validation(['body']);
  if (typeof b.chat_room_id !== 'string' || !b.chat_room_id || b.chat_room_id.length > 128) bad.push('chat_room_id');
  if (!Array.isArray(b.incoming_messages) || b.incoming_messages.length > 500
    || !b.incoming_messages.every((m) => isObj(m) && typeof m.message_id === 'string' && typeof m.sender === 'string' && typeof m.text === 'string')) {
    bad.push('incoming_messages');
  }
  if (b.check_dlq !== undefined && typeof b.check_dlq !== 'boolean') bad.push('check_dlq');
  const n = b.simulate_failed_notifications;
  if (n !== undefined && (!Number.isInteger(n) || n < 0 || n > 100)) bad.push('simulate_failed_notifications');
  if (bad.length) throw validation(bad);
}

const failingSend = async () => { throw new Error('simulated downstream push failure'); };

async function moderationTest(b) {
  validateTest(b);
  const roomId = b.chat_room_id;
  return withLock('room:' + roomId, async () => {
    const r = room(roomId);
    const filtered = [];
    let flagged = 0;
    for (const m of b.incoming_messages) {
      const res = moderateOne(roomId, r, m);
      if (res.flagged) flagged += 1;
      if (!res.dropped) filtered.push(res.message);
    }
    for (let i = 0; i < (b.simulate_failed_notifications || 0); i++) {
      await dlq.deliver({ event_id: `ntf-${crypto.randomBytes(5).toString('hex')}`, type: 'chat.notification', chat_room_id: roomId }, failingSend);
    }
    const dlqStatus = await dlq.status();
    const kicked = [...r.kicked];
    return {
      chat_room_id: roomId,
      filtered_messages: filtered,
      kicked_users: kicked,
      muted_users: [...r.muted],
      dlq_status: dlqStatus,
      flagged_count: flagged,
      signature: signDay2(roomId, { chat_room_id: roomId, flagged_count: flagged, kicked_users: kicked, queue_depth: dlqStatus.queue_depth }),
    };
  });
}

// Member chat (POST /api/v1/chat): same filter, plus the 3-messages-per-2-seconds sliding window per sender.
async function postChat(user, b) {
  const bad = [];
  if (!isObj(b) || typeof b.chat_room_id !== 'string' || !b.chat_room_id) bad.push('chat_room_id');
  if (!isObj(b) || typeof b.text !== 'string' || !b.text.trim() || b.text.length > 500) bad.push('text');
  if (bad.length) throw validation(bad);
  const sender = user.player_id || user.sub;
  return withLock('room:' + b.chat_room_id, async () => {
    const r = room(b.chat_room_id);
    if (r.kicked.includes(sender) || r.muted.includes(sender)) {
      throw err(403, 'FORBIDDEN', 'You have been muted in this chat by the moderators.', { sender });
    }
    const now = Date.now();
    const times = (r.posts.get(sender) || []).filter((t) => now - t < 2000);
    if (times.length >= 3) {
      addOnce(r.kicked, sender);
      addOnce(r.muted, sender);
      persist(b.chat_room_id, r, null);
      throw err(429, 'RATE_LIMITED', 'You are sending messages too quickly.', { reason: 'rate_limit_exceeded' });
    }
    times.push(now);
    r.posts.set(sender, times);
    const res = moderateOne(b.chat_room_id, r, { message_id: b.message_id || `msg-${crypto.randomBytes(5).toString('hex')}`, sender, text: b.text });
    if (res.dropped) return { status: 200, body: { accepted: false, flagged: true, reason: res.reason } };
    return { status: 201, body: { accepted: true, message: res.message } };
  });
}

async function history(roomId) {
  const r = rooms.get(roomId);
  if (r && r.recent.length) return r.recent;
  const rows = (await pool.query('SELECT * FROM chat_messages WHERE room_id = $1 ORDER BY seq DESC LIMIT 100', [roomId])).rows.reverse();
  return rows.map((m) => ({ chat_room_id: m.room_id, seq: m.seq, message_id: m.message_id, sender: m.sender, text: m.text, flagged: m.flagged, reason: m.reason }));
}

module.exports = { moderationTest, postChat, history, maskProfanity, isFlood, isProfane };
