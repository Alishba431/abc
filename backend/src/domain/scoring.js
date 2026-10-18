// Pure projection: score is always rebuilt from the append-only event log (Section 5.9).
const { limits } = require('./sports');

// Lifecycle events beyond start/end (FR-1.3 state machine); several spellings are accepted.
const STATUS_EVENTS = {
  match_postpone: 'postponed', match_postponed: 'postponed', postpone: 'postponed',
  match_cancel: 'cancelled', match_cancelled: 'cancelled', cancel: 'cancelled',
  match_abandon: 'abandoned', match_abandoned: 'abandoned', abandon: 'abandoned',
};
const STATUS_VALUES = ['postponed', 'cancelled', 'abandoned', 'upcoming'];

function statusTarget(e) {
  if (STATUS_EVENTS[e.type]) return STATUS_EVENTS[e.type];
  if (e.type === 'match_status' && e.payload && STATUS_VALUES.includes(e.payload.status)) return e.payload.status;
  return null;
}

function compensationMap(events) {
  const by = {};
  for (const e of events) if (e.type === 'compensation') by[e.payload.compensates] = e.event_id;
  return by;
}

function project(sport, match, events) {
  const compBy = compensationMap(events);
  const active = (e) => !compBy[e.event_id] && e.type !== 'compensation';
  const side = () => ({ score: 0, wickets: 0, balls: 0, fair_play: 0 });
  const t = { [match.home]: side(), [match.away]: side() };
  let status = 'upcoming';
  let tiebreak = null;
  const model = sport.scoring_model;

  for (const e of events) {
    if (e.type === 'match_start') status = 'in_progress';
    else if (e.type === 'match_end') status = 'completed';
    else if (statusTarget(e)) status = statusTarget(e);
    if (!active(e)) continue;
    const s = t[e.payload.team_id];
    if (e.type === 'score' && s) {
      const def = sport.scoring_events[e.payload.event_type] || {};
      if (model === 'event') s.score += def.points || 0;
      else if (model === 'round') s.score += def.rounds || 0;
      else {
        s.score += def.runs || 0;
        if (def.legal_ball) s.balls += 1;
        if (def.wicket) s.wickets += 1;
      }
    } else if (e.type === 'discipline' && s) s.fair_play += e.payload.points;
    else if (e.type === 'tiebreak_winner' && s) tiebreak = e.payload.team_id;
  }

  const H = t[match.home], A = t[match.away];
  let winner = null, outcome = 'pending';
  if (status === 'completed') {
    if (H.score !== A.score) winner = H.score > A.score ? match.home : match.away;
    else if (tiebreak) winner = tiebreak;
    if (winner) outcome = winner === match.home ? 'home_win' : 'away_win';
    else outcome = sport.draw_allowed ? 'draw' : 'undecided';
  }
  const bpo = model === 'innings' ? sport.periods.balls_per_over : null;
  const view = (team, s) => ({
    team_id: team, score: s.score,
    wickets: model === 'innings' ? s.wickets : null,
    balls: model === 'innings' ? s.balls : null,
    overs: model === 'innings' ? `${Math.floor(s.balls / bpo)}.${s.balls % bpo}` : null,
    fair_play: s.fair_play,
  });
  return {
    status, outcome, winner, tiebreak, teams: t,
    home: view(match.home, H), away: view(match.away, A),
    compBy,
  };
}

// Rejection code for a new score event given the current projection, or null if allowed.
function scoreLimitError(sport, proj, teamId) {
  const lim = limits(sport);
  if (sport.scoring_model === 'innings') {
    const s = proj.teams[teamId];
    if (s.balls >= lim.balls || s.wickets >= lim.wickets) return 'INNINGS_COMPLETE';
  } else if (sport.scoring_model === 'round') {
    if (Object.values(proj.teams).some((s) => s.score >= lim.rounds)) return 'SERIES_ALREADY_DECIDED';
  }
  return null;
}

module.exports = { project, scoreLimitError, statusTarget, STATUS_EVENTS, STATUS_VALUES };
