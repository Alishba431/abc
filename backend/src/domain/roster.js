// Roster scenarios, transfers/loans/releases with ordered rule checks, immutable audit trail (Section 5.11).
const { pool, tx } = require('../db');
const { err } = require('../errors');
const { canonical } = require('../sign');
const { withLock, isoNow, today } = require('../util');
const { Checker, isObj, isId, isStr, isDate, isInt } = require('../validate');
const { publish } = require('../queue');

const ROLES = ['captain', 'vice_captain', 'starter', 'substitute'];
const TYPES = ['transfer', 'loan', 'release'];
const ROSTER_LOCK = 'roster';

const addDays = (d, n) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

function validateSetup(b) {
  const c = new Checker();
  if (!isObj(b)) { c.check(false, 'body'); c.done(); }
  const l = b.league;
  if (c.check(isObj(l), 'league')) {
    c.check(isId(l.league_id), 'league.league_id');
    c.check(isId(l.tenant_id), 'league.tenant_id');
    c.check(isId(l.sport_id), 'league.sport_id');
    c.check(isObj(l.transfer_window) && isDate(l.transfer_window.open) && isDate(l.transfer_window.close)
      && l.transfer_window.open <= l.transfer_window.close, 'league.transfer_window');
    if (l.max_squad_size !== undefined && l.max_squad_size !== null) c.check(isInt(l.max_squad_size) && l.max_squad_size >= 1, 'league.max_squad_size');
    if (l.required_positions !== undefined && l.required_positions !== null) {
      c.check(isObj(l.required_positions) && Object.values(l.required_positions).every((n) => isInt(n) && n >= 0), 'league.required_positions');
    }
  }
  if (c.check(Array.isArray(b.squads), 'squads')) {
    b.squads.forEach((s, i) => c.check(isObj(s) && isId(s.squad_id) && isId(s.club_id) && isId(s.tenant_id), `squads[${i}]`));
  }
  if (c.check(Array.isArray(b.players), 'players')) {
    b.players.forEach((p, i) => c.check(isObj(p) && isId(p.player_id) && isStr(p.position, 1, 40)
      && (p.squad_id === null || isId(p.squad_id)) && (p.role === undefined || ROLES.includes(p.role)), `players[${i}]`));
  }
  if (b.matches_in_progress !== undefined) {
    c.check(Array.isArray(b.matches_in_progress) && b.matches_in_progress.every((m) => isObj(m) && isId(m.match_id)
      && isId(m.home_squad_id) && isId(m.away_squad_id)), 'matches_in_progress');
  }
  c.done();
}

async function setup(b) {
  validateSetup(b);
  const l = b.league;
  const sport = await pool.query('SELECT config FROM sports WHERE id = $1', [l.sport_id]);
  if (!sport.rowCount) throw err(404, 'SPORT_NOT_FOUND', `Sport ${l.sport_id} does not exist.`, { sport_id: l.sport_id });
  const squadIds = new Set(b.squads.map((s) => s.squad_id));
  const badPlayer = b.players.find((p) => p.squad_id && !squadIds.has(p.squad_id));
  if (badPlayer) throw err(404, 'SQUAD_NOT_FOUND', `Squad ${badPlayer.squad_id} does not exist.`, { squad_id: badPlayer.squad_id });
  const roster = sport.rows[0].config.roster;
  const data = {
    league_id: l.league_id, tenant_id: l.tenant_id, sport_id: l.sport_id, transfer_window: l.transfer_window,
    max_squad_size: l.max_squad_size ?? roster.max_squad_size,
    required_positions: l.required_positions ?? roster.required_positions,
    matches_in_progress: b.matches_in_progress || [],
  };
  return withLock(ROSTER_LOCK, () => tx(async (c) => {
    const old = await c.query('SELECT id FROM players WHERE league_id = $1', [l.league_id]);
    const ids = [...old.rows.map((r) => r.id), ...b.players.map((p) => p.player_id)];
    await c.query('DELETE FROM audit WHERE player_id = ANY($1)', [ids]);
    await c.query('DELETE FROM players WHERE league_id = $1 OR id = ANY($2)', [l.league_id, ids]);
    await c.query('DELETE FROM squads WHERE league_id = $1 OR id = ANY($2)', [l.league_id, [...squadIds]]);
    await c.query('INSERT INTO roster_leagues(id, data) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [l.league_id, data]);
    for (const s of b.squads) await c.query('INSERT INTO squads(id, league_id, data) VALUES ($1,$2,$3)', [s.squad_id, l.league_id, s]);
    const counts = Object.fromEntries(b.squads.map((s) => [s.squad_id, 0]));
    for (const p of b.players) {
      await c.query('INSERT INTO players(id, league_id, data) VALUES ($1,$2,$3)', [p.player_id, l.league_id, {
        player_id: p.player_id, name: p.name || p.player_id, position: p.position, role: p.role || 'substitute',
        initial_squad_id: p.squad_id || null, squad_id: p.squad_id || null, parent_squad_id: null,
        registration_type: 'initial', start_date: null, loan_end_date: null,
      }]);
      if (p.squad_id) counts[p.squad_id]++;
    }
    return { league_id: l.league_id, status: 'configured', squad_counts: counts };
  }));
}

function validateTransfer(b) {
  const c = new Checker();
  if (!isObj(b)) { c.check(false, 'body'); c.done(); }
  c.check(isId(b.request_id), 'request_id');
  c.check(isId(b.league_id), 'league_id');
  c.check(isId(b.player_id), 'player_id');
  c.check(TYPES.includes(b.type), 'type');
  c.check(isId(b.from_squad_id), 'from_squad_id');
  if (b.type === 'release') c.check(b.to_squad_id === null || b.to_squad_id === undefined || isId(b.to_squad_id), 'to_squad_id');
  else c.check(isId(b.to_squad_id), 'to_squad_id');
  c.check(isDate(b.effective_date), 'effective_date');
  if (b.type === 'loan') c.check(isDate(b.loan_end_date) && isDate(b.effective_date) && b.loan_end_date > b.effective_date, 'loan_end_date');
  else c.check(b.loan_end_date === null || b.loan_end_date === undefined || isDate(b.loan_end_date), 'loan_end_date');
  c.check(typeof b.reason === 'string', 'reason');
  c.check(isStr(b.requested_by, 1, 128), 'requested_by');
  c.done();
}

const transferKey = (b) => canonical({ ...b, to_squad_id: b.to_squad_id ?? null, loan_end_date: b.loan_end_date ?? null });

async function nextAuditId(c) {
  const r = await c.query("SELECT count(*)::int AS n FROM audit");
  return 'au-' + String(r.rows[0].n + 1).padStart(4, '0');
}

// Writes the loan_return entry once, the first time a date after loan_end_date is observed.
async function materializeReturn(c, player, asOf) {
  const p = player.data;
  if (p.registration_type !== 'loan' || !p.loan_end_date || asOf <= p.loan_end_date) return p;
  const back = addDays(p.loan_end_date, 1);
  const entry = {
    audit_id: await nextAuditId(c), action: 'loan_return', player_id: p.player_id, league_id: player.league_id,
    from_squad_id: p.squad_id, to_squad_id: p.parent_squad_id, effective_date: back, state: 'active',
    who: 'system', when: isoNow(), why: 'Loan period ended',
  };
  await c.query('INSERT INTO audit(player_id, entry) VALUES ($1,$2)', [p.player_id, entry]);
  const next = { ...p, squad_id: p.parent_squad_id, parent_squad_id: null, role: 'substitute',
    registration_type: 'loan_return', start_date: back, loan_end_date: null };
  await c.query('UPDATE players SET data = $2 WHERE id = $1', [p.player_id, next]);
  publish('roster.loan_returned', { player_id: p.player_id, squad_id: next.squad_id });
  return next;
}

async function transfer(b) {
  validateTransfer(b);
  return withLock(ROSTER_LOCK, async () => {
    const prev = await pool.query('SELECT body_key, response FROM roster_requests WHERE request_id = $1', [b.request_id]);
    if (prev.rowCount) {
      if (prev.rows[0].body_key !== transferKey(b)) {
        throw err(409, 'DUPLICATE_REQUEST_ID', `Request ${b.request_id} already exists with a different body.`, { request_id: b.request_id });
      }
      return { status: 200, body: prev.rows[0].response };
    }
    return tx(async (c) => {
      const lg = await c.query('SELECT data FROM roster_leagues WHERE id = $1', [b.league_id]);
      if (!lg.rowCount) throw err(404, 'LEAGUE_NOT_FOUND', `League ${b.league_id} does not exist.`, { league_id: b.league_id });
      const league = lg.rows[0].data;
      const pl = await c.query('SELECT * FROM players WHERE id = $1 AND league_id = $2', [b.player_id, b.league_id]);
      if (!pl.rowCount) throw err(404, 'PLAYER_NOT_FOUND', `Player ${b.player_id} does not exist.`, { player_id: b.player_id });
      const squadIds = [b.from_squad_id, ...(b.type === 'release' || !b.to_squad_id ? [] : [b.to_squad_id])];
      const sq = await c.query('SELECT id, data FROM squads WHERE league_id = $1 AND id = ANY($2)', [b.league_id, squadIds]);
      const squads = Object.fromEntries(sq.rows.map((s) => [s.id, s.data]));
      const missing = squadIds.find((id) => !squads[id]);
      if (missing) throw err(404, 'SQUAD_NOT_FOUND', `Squad ${missing} does not exist.`, { squad_id: missing });
      if (squadIds.some((id) => squads[id].tenant_id !== league.tenant_id)) {
        throw err(409, 'CROSS_TENANT_TRANSFER', 'Squads must belong to the league tenant.', { league_id: b.league_id });
      }
      const p = await materializeReturn(c, pl.rows[0], b.effective_date);
      if (p.squad_id !== b.from_squad_id) {
        throw err(409, 'NOT_IN_SQUAD', `Player ${b.player_id} is not in squad ${b.from_squad_id}.`, { player_id: b.player_id, squad_id: p.squad_id });
      }
      const w = league.transfer_window;
      if (b.type !== 'release' && (b.effective_date < w.open || b.effective_date > w.close)) {
        throw err(409, 'TRANSFER_WINDOW_CLOSED', 'Effective date is outside the transfer window.', { open: w.open, close: w.close });
      }
      if (p.registration_type === 'loan') throw err(409, 'PLAYER_ON_LOAN', `Player ${b.player_id} is on loan.`, { player_id: b.player_id });
      const all = (await c.query('SELECT data FROM players WHERE league_id = $1', [b.league_id])).rows.map((r) => r.data);
      if (b.type !== 'release') {
        const toCount = all.filter((x) => x.squad_id === b.to_squad_id).length;
        if (toCount + 1 > league.max_squad_size) {
          throw err(409, 'SQUAD_FULL', `Squad ${b.to_squad_id} is full.`, { squad_id: b.to_squad_id, max_squad_size: league.max_squad_size });
        }
      }
      const need = (league.required_positions || {})[p.position];
      if (need !== undefined) {
        const left = all.filter((x) => x.squad_id === b.from_squad_id && x.position === p.position).length - 1;
        if (left < need) {
          throw err(409, 'MIN_POSITION_VIOLATION', `Squad ${b.from_squad_id} would have too few ${p.position}.`,
            { squad_id: b.from_squad_id, position: p.position, required: need });
        }
      }

      const live = (league.matches_in_progress || []).find((m) => m.home_squad_id === b.from_squad_id || m.away_squad_id === b.from_squad_id);
      const state = live ? 'deferred_until_match_end' : 'active';
      let next;
      if (b.type === 'release') {
        next = { ...p, squad_id: null, parent_squad_id: null, registration_type: 'release', start_date: b.effective_date, loan_end_date: null };
      } else if (b.type === 'loan') {
        next = { ...p, squad_id: b.to_squad_id, parent_squad_id: b.from_squad_id, role: 'substitute',
          registration_type: 'loan', start_date: b.effective_date, loan_end_date: b.loan_end_date };
      } else {
        next = { ...p, squad_id: b.to_squad_id, parent_squad_id: null, role: 'substitute',
          registration_type: 'transfer', start_date: b.effective_date, loan_end_date: null };
      }
      await c.query('UPDATE players SET data = $2 WHERE id = $1', [p.player_id, next]);
      const entry = {
        audit_id: await nextAuditId(c), action: b.type, player_id: b.player_id, league_id: b.league_id,
        from_squad_id: b.from_squad_id, to_squad_id: b.type === 'release' ? null : b.to_squad_id,
        effective_date: b.effective_date, state, who: b.requested_by, when: isoNow(), why: b.reason,
      };
      await c.query('INSERT INTO audit(player_id, entry) VALUES ($1,$2)', [b.player_id, entry]);
      const response = {
        request_id: b.request_id, status: 'accepted', state, blocking_match_id: live ? live.match_id : null,
        registration: b.type === 'release' ? null : {
          player_id: b.player_id, league_id: b.league_id, squad_id: next.squad_id, parent_squad_id: next.parent_squad_id,
          registration_type: b.type, start_date: b.effective_date, loan_end_date: next.loan_end_date, role: next.role,
        },
        audit_entry: entry,
      };
      await c.query('INSERT INTO roster_requests(request_id, body_key, response) VALUES ($1,$2,$3)', [b.request_id, transferKey(b), response]);
      publish('roster.' + b.type, { player_id: b.player_id, league_id: b.league_id, state });
      return { status: 201, body: response };
    });
  });
}

async function history(playerId, asOfRaw) {
  if (asOfRaw !== undefined && !isDate(asOfRaw)) throw err(400, 'VALIDATION_ERROR', 'as_of must be YYYY-MM-DD.', { fields: ['as_of'] });
  const asOf = asOfRaw || today();
  return withLock(ROSTER_LOCK, () => tx(async (c) => {
    const pl = await c.query('SELECT * FROM players WHERE id = $1', [playerId]);
    if (!pl.rowCount) throw err(404, 'PLAYER_NOT_FOUND', `Player ${playerId} does not exist.`, { player_id: playerId });
    const p = await materializeReturn(c, pl.rows[0], asOf);
    const entries = (await c.query('SELECT entry FROM audit WHERE player_id = $1 ORDER BY n', [playerId])).rows.map((r) => r.entry);
    // Replay the trail up to as_of to find the squad on that date.
    let squad = p.initial_squad_id, parent = null;
    for (const e of entries) {
      if (e.effective_date > asOf) continue;
      if (e.action === 'loan') { squad = e.to_squad_id; parent = e.from_squad_id; }
      else if (e.action === 'release') { squad = null; parent = null; }
      else { squad = e.to_squad_id; parent = null; }
    }
    return { player_id: playerId, as_of: asOf, league_id: pl.rows[0].league_id, current_squad_id: squad, parent_squad_id: parent, history: entries };
  }));
}

async function auditCount(playerId) {
  const r = await pool.query('SELECT count(*)::int AS n FROM audit WHERE player_id = $1', [playerId]);
  return r.rows[0].n;
}

module.exports = { setup, transfer, history, auditCount, validateTransfer, transferKey };
