// Right to erasure (NFR-9): wipe PII for a user and unlink every guest/viewer token tied to them.
const crypto = require('crypto');
const { pool, tx } = require('../db');
const { err } = require('../errors');

async function eraseUser(userId) {
  const found = await pool.query(`SELECT 1 FROM club_players WHERE id = $1 UNION ALL SELECT 1 FROM players WHERE id = $1
    UNION ALL SELECT 1 FROM users WHERE id = $1 OR claims->>'player_id' = $1 LIMIT 1`, [userId]);
  if (!found.rowCount) throw err(404, 'PLAYER_NOT_FOUND', `User ${userId} does not exist.`, { user_id: userId });
  const anon = crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12);
  await tx(async (c) => {
    await c.query(`UPDATE club_players SET data = (data - 'name' - 'email' - 'phone') || $2 WHERE id = $1`, [userId, { name: 'Anonymized user', anonymized: true }]);
    await c.query(`UPDATE players SET data = (data - 'name' - 'email' - 'phone') || $2 WHERE id = $1`, [userId, { name: 'Anonymized user', anonymized: true }]);
    await c.query(`UPDATE users SET email = $2, password_hash = $3 WHERE id = $1 OR claims->>'player_id' = $1`,
      [userId, `erased-${anon}@anonymized.invalid`, `x:${crypto.randomBytes(16).toString('hex')}`]);
    await c.query(`UPDATE guest_tokens SET status = 'anonymized', merged_user_id = NULL, linked_user_id = NULL, merge_key = NULL,
      merged_response = NULL WHERE merged_user_id = $1 OR linked_user_id = $1`, [userId]);
  });
  return { user_id: userId, status: 'anonymized', pii_retained: false, tokens_wiped: true };
}

module.exports = { eraseUser };
