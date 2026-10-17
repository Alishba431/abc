// Sport rules are pure data (Section 5.6). Nothing in the domain branches on a sport or event name.
const { Checker, isObj, isInt, isStr } = require('../validate');

const MODELS = ['event', 'innings', 'round'];
const OVERTIME = ['none', 'extra_time', 'shootout', 'golden_score', 'super_over'];
const TIE_BREAKS = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];
const SPORT_ID_RE = /^[a-z0-9_-]{2,40}$/;
const EVENT_KEY_RE = /^[a-z0-9_]{1,40}$/;

function validateSport(b) {
  const c = new Checker();
  if (!isObj(b)) { c.check(false, 'body'); c.done(); }
  c.check(typeof b.sport_id === 'string' && SPORT_ID_RE.test(b.sport_id), 'sport_id');
  c.check(isStr(b.name, 1, 80), 'name');
  const model = b.scoring_model;
  c.check(MODELS.includes(model), 'scoring_model');
  const p = b.periods;
  if (c.check(isObj(p), 'periods') && MODELS.includes(model)) {
    if (model === 'event') {
      c.check(isInt(p.count) && p.count >= 1, 'periods.count');
      c.check(isInt(p.duration_minutes) && p.duration_minutes >= 1, 'periods.duration_minutes');
    } else if (model === 'innings') {
      for (const k of ['innings_per_team', 'overs_per_innings', 'balls_per_over', 'wickets_per_innings']) {
        c.check(isInt(p[k]) && p[k] >= 1, `periods.${k}`);
      }
    } else {
      c.check(isInt(p.best_of) && p.best_of >= 1 && p.best_of % 2 === 1, 'periods.best_of');
    }
  }
  const se = b.scoring_events;
  if (c.check(isObj(se) && Object.keys(se).length >= 1, 'scoring_events') && MODELS.includes(model)) {
    for (const [k, v] of Object.entries(se)) {
      const f = `scoring_events.${k}`;
      if (!c.check(EVENT_KEY_RE.test(k) && isObj(v), f)) continue;
      if (model === 'event') c.check(isInt(v.points) && v.points >= 1, f);
      else if (model === 'innings') {
        c.check(isInt(v.runs) && v.runs >= 0 && typeof v.legal_ball === 'boolean' && typeof v.wicket === 'boolean', f);
      } else c.check(isInt(v.rounds) && v.rounds >= 1, f);
    }
  }
  c.check(typeof b.draw_allowed === 'boolean', 'draw_allowed');
  const ot = b.overtime;
  if (c.check(isObj(ot), 'overtime')) {
    c.check(OVERTIME.includes(ot.policy), 'overtime.policy');
    if (ot.duration_minutes !== undefined) c.check(isInt(ot.duration_minutes) && ot.duration_minutes >= 0, 'overtime.duration_minutes');
  }
  if (b.tie_break_order !== undefined) c.check(validTieBreak(b.tie_break_order), 'tie_break_order');
  const r = b.roster;
  if (c.check(isObj(r), 'roster')) {
    c.check(isInt(r.min_squad_size) && r.min_squad_size >= 1, 'roster.min_squad_size');
    c.check(isInt(r.max_squad_size) && r.max_squad_size >= 1, 'roster.max_squad_size');
    if (isInt(r.min_squad_size) && isInt(r.max_squad_size)) c.check(r.min_squad_size <= r.max_squad_size, 'roster.max_squad_size');
    c.check(isObj(r.required_positions) && Object.values(r.required_positions).every((n) => isInt(n) && n >= 0),
      'roster.required_positions');
  }
  c.done();
  const config = {
    sport_id: b.sport_id, name: b.name, scoring_model: model, periods: p, scoring_events: se,
    draw_allowed: b.draw_allowed, overtime: ot, roster: r,
  };
  if (b.tie_break_order !== undefined) config.tie_break_order = b.tie_break_order;
  return config;
}

function validTieBreak(t) {
  return Array.isArray(t) && t.every((x) => TIE_BREAKS.includes(x)) && new Set(t).size === t.length;
}

// Effective order: given order (or the full default), with draw_lots always last.
function tieBreakOrder(order) {
  const base = (order && order.length ? order : TIE_BREAKS).filter((x) => x !== 'draw_lots');
  return [...base, 'draw_lots'];
}

// Win threshold for round (best-of-N) models and innings limits, all derived from config.
function limits(sport) {
  const p = sport.periods;
  if (sport.scoring_model === 'innings') {
    return { balls: p.innings_per_team * p.overs_per_innings * p.balls_per_over, wickets: p.innings_per_team * p.wickets_per_innings };
  }
  if (sport.scoring_model === 'round') return { rounds: (p.best_of + 1) / 2 };
  return {};
}

module.exports = { validateSport, validTieBreak, tieBreakOrder, limits, TIE_BREAKS };
