// A "player" for Phase II is any seeded club player (RBAC scenario) or roster-registered player.
async function playerExists(q, id) {
  const r = await q.query('SELECT 1 FROM club_players WHERE id = $1 UNION ALL SELECT 1 FROM players WHERE id = $1 LIMIT 1', [id]);
  return r.rowCount > 0;
}

async function missingPlayer(q, ids) {
  for (const id of ids) if (!(await playerExists(q, id))) return id;
  return null;
}

module.exports = { playerExists, missingPlayer };
