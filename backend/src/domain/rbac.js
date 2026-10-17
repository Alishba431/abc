// Policy-as-code: one declarative matrix decides every probe (Section 5.13).
const { pool } = require('../db');
const { err } = require('../errors');

// scope: what the actor must own for "own" access. Roles not listed are denied.
const POLICY = {
  'tenants:create': { super_admin: 'any' },
  'league:fixtures:write': { super_admin: 'any', league_organizer: 'own_league' },
  'club:roster:write': { super_admin: 'any', club_manager: 'own_club' },
  'club:products:write': { super_admin: 'any', club_manager: 'own_club' },
  'player:update': { super_admin: 'any', club_manager: 'own_club_player', player: 'self' },
  'club:read': { super_admin: 'any', league_organizer: 'same_tenant', club_manager: 'same_tenant', player: 'same_tenant', viewer: 'same_tenant' },
  'platform:config:read': { super_admin: 'any' },
};

async function lookup(kind, id) {
  const table = { league: 'leagues_rbac', club: 'clubs', player: 'club_players' }[kind];
  const r = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return r.rows[0] || null;
}

// Returns nothing when allowed; throws 403/404 otherwise. Unknown resources are 404 only for roles
// that could ever be granted the action; everyone else is denied first.
async function authorize(user, action, kind, id) {
  const scope = (POLICY[action] || {})[user.role];
  if (!scope) throw err(403, 'FORBIDDEN', 'You are not allowed to perform this action.', {});
  if (!kind) return;
  const res = await lookup(kind, id);
  if (!res) throw err(404, `${kind.toUpperCase()}_NOT_FOUND`, `${kind} ${id} does not exist.`, {});
  if (scope === 'any') return;
  const sameTenant = res.tenant_id === user.tenant_id;
  const ok = sameTenant && (
    (scope === 'same_tenant')
    || (scope === 'own_league' && (user.league_ids || []).includes(res.id))
    || (scope === 'own_club' && (user.club_ids || []).includes(res.id))
    || (scope === 'own_club_player' && (user.club_ids || []).includes(res.club_id))
    || (scope === 'self' && user.player_id === res.id));
  if (!ok) throw err(403, 'FORBIDDEN', 'You are not allowed to access this resource.', {});
}

module.exports = { POLICY, authorize };
