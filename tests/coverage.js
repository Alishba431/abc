// Parses Node's built-in coverage table and writes per-area line coverage to COVERAGE.json.
const fs = require('fs');
const path = require('path');

const AREAS = {
  fixtures: ['domain/fixtures.js'],
  scoring: ['domain/events.js', 'domain/scoring.js', 'domain/sports.js', 'sign.js'],
  standings: ['domain/standings.js', 'domain/leagues.js'],
  store: ['domain/store.js', 'pdf.js'],
  roster: ['domain/roster.js', 'domain/offline.js'],
  rbac: ['domain/rbac.js', 'auth.js', 'ratelimit.js'],
};

// Part II (Section 7.2): the five Phase II backend modules.
const AREAS_DAY2 = {
  streaming: ['domain/streaming.js', 'media.js'],
  costream: ['domain/costream.js'],
  qr_guest: ['domain/qr.js', 'domain/guest.js'],
  moderation_dlq: ['domain/moderation.js', 'domain/dlq.js'],
  observability: ['metrics.js', 'realtime.js', 'domain/privacy.js'],
};

const text = fs.readFileSync(process.argv[2], 'utf8');
const lines = {};
let dir = [];
for (const raw of text.split('\n')) {
  const row = raw.replace(/^(#|ℹ)\s?/, '');
  const m = /^(\s*)(\S.*?)\s*\|\s*([\d.]+)?\s*\|/.exec(row);
  if (!m) continue;
  const depth = m[1].length;
  const name = m[2].trim();
  if (name === 'file' || name.startsWith('all files')) continue;
  dir = dir.slice(0, depth);
  if (m[3] === undefined) { dir[depth] = name; continue; }
  const full = [...dir.slice(0, depth).filter(Boolean), name].join('/');
  lines[full] = parseFloat(m[3]);
}
const find = (f) => {
  const key = Object.keys(lines).find((k) => k === f || k.endsWith('/' + f) || k.endsWith('src/' + f));
  return key ? lines[key] : 0;
};
function write(areas, file) {
  const out = {};
  for (const [area, files] of Object.entries(areas)) {
    const vals = files.map(find);
    out[area] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  }
  fs.writeFileSync(path.join(__dirname, '..', file), JSON.stringify(out, null, 2) + '\n');
  console.log(`\n${file}`, JSON.stringify(out));
}
write(AREAS, 'COVERAGE.json');
write(AREAS_DAY2, 'COVERAGE_DAY2.json');
