// Pure standings engine (Section 5.10): recursive tie-break resolution, H2H, NRR, qualification.
const { sha256hex } = require('../sign');
const { tieBreakOrder } = require('./sports');

const round3 = (x) => Math.round(x * 1000) / 1000;

// results: [{ home, away, hs, as, hb, ab, hw, aw, hfp, afp, winner }] for played matches only.
function computeStandings({ leagueId, sport, teams, results, remaining, points, tieBreak, spots, lotsSeed }) {
  const model = sport.scoring_model;
  const per = sport.periods;
  const fullOvers = model === 'innings' ? per.innings_per_team * per.overs_per_innings : 0;
  const allOut = model === 'innings' ? per.innings_per_team * per.wickets_per_innings : 0;
  const oversFaced = (balls, wickets) => (wickets >= allOut ? fullOvers : balls / per.balls_per_over);

  const blank = () => ({ played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0, fair_play: 0, pts: 0, of: 0, ob: 0 });
  // Accumulate over an arbitrary subset of matches (used for whole league and for mini-leagues).
  function aggregate(subset, teamSet) {
    const acc = {};
    for (const t of teamSet) acc[t] = blank();
    for (const m of subset) {
      const H = acc[m.home], A = acc[m.away];
      if (!H || !A) continue;
      H.played++; A.played++;
      H.scored += m.hs; H.conceded += m.as; A.scored += m.as; A.conceded += m.hs;
      H.fair_play += m.hfp; A.fair_play += m.afp;
      if (model === 'innings') {
        const hf = oversFaced(m.hb, m.hw), af = oversFaced(m.ab, m.aw);
        H.of += hf; H.ob += af; A.of += af; A.ob += hf;
      }
      if (m.winner === m.home) { H.won++; A.lost++; H.pts += points.win; A.pts += points.loss; }
      else if (m.winner === m.away) { A.won++; H.lost++; A.pts += points.win; H.pts += points.loss; }
      else { H.drawn++; A.drawn++; H.pts += points.draw; A.pts += points.draw; }
    }
    return acc;
  }
  const diffOf = (a) => {
    if (model === 'innings') {
      const rf = a.of > 0 ? a.scored / a.of : 0;
      const ra = a.ob > 0 ? a.conceded / a.ob : 0;
      return round3(rf - ra);
    }
    return a.scored - a.conceded;
  };

  const all = aggregate(results, teams);
  const lots = (t) => sha256hex(`${lotsSeed}|${leagueId}|${t}`);

  function criterion(name, group) {
    if (name === 'draw_lots') return null;
    const vals = {};
    if (name === 'h2h_points' || name === 'h2h_diff') {
      const g = new Set(group);
      const mini = aggregate(results.filter((m) => g.has(m.home) && g.has(m.away)), group);
      for (const t of group) vals[t] = name === 'h2h_points' ? mini[t].pts : diffOf(mini[t]);
    } else {
      for (const t of group) {
        const a = all[t];
        vals[t] = name === 'overall_diff' ? diffOf(a) : name === 'scored' ? a.scored : a.fair_play;
      }
    }
    return vals;
  }

  const resolvedBy = {};
  const order = tieBreakOrder(tieBreak);
  function resolve(group) {
    if (group.length < 2) return group;
    for (const name of order) {
      if (name === 'draw_lots') {
        const sorted = [...group].sort((a, b) => (lots(a) < lots(b) ? -1 : lots(a) > lots(b) ? 1 : 0));
        for (let i = 0; i < sorted.length - 1; i++) resolvedBy[sorted[i]] = 'draw_lots';
        return sorted;
      }
      const vals = criterion(name, group);
      const distinct = [...new Set(group.map((t) => vals[t]))].sort((a, b) => b - a);
      if (distinct.length === 1) continue;
      const out = [];
      distinct.forEach((v, i) => {
        const sub = group.filter((t) => vals[t] === v);
        const resolved = resolve(sub);
        if (i < distinct.length - 1) resolvedBy[resolved[resolved.length - 1]] = name;
        out.push(...resolved);
      });
      return out;
    }
    return group;
  }

  const byPoints = {};
  for (const t of teams) (byPoints[all[t].pts] = byPoints[all[t].pts] || []).push(t);
  const ranked = [];
  for (const p of Object.keys(byPoints).map(Number).sort((a, b) => b - a)) {
    // keep registration order inside a group as the stable base before resolution
    ranked.push(...resolve(byPoints[p]));
  }

  const maxPts = (t) => all[t].pts + points.win * (remaining[t] || 0);
  const status = (t) => {
    const others = teams.filter((x) => x !== t);
    if (others.filter((x) => maxPts(x) >= all[t].pts).length < spots) return 'clinched';
    if (others.filter((x) => all[x].pts > maxPts(t)).length >= spots) return 'eliminated';
    return 'still_possible';
  };

  const table = ranked.map((t, i) => {
    const a = all[t];
    return {
      rank: i + 1, team_id: t, played: a.played, won: a.won, drawn: a.drawn, lost: a.lost,
      scored: a.scored, conceded: a.conceded, diff: diffOf(a), points: a.pts, fair_play: a.fair_play,
      status: status(t), resolved_by: resolvedBy[t] || null,
    };
  });

  const h2h = {};
  for (const a of teams) {
    h2h[a] = {};
    for (const b of teams) {
      if (a === b) continue;
      const pair = aggregate(results.filter((m) => (m.home === a && m.away === b) || (m.home === b && m.away === a)), [a, b]);
      h2h[a][b] = { played: pair[a].played, points: pair[a].pts, scored: pair[a].scored, conceded: pair[a].conceded };
    }
  }
  return { table, h2h };
}

module.exports = { computeStandings };
