// nascon:// deep links (Part II 6.3): nascon://entity/{id} and nascon://stream/{session} open the right screen
// directly — guests included, so a deep link never stops at the login screen.
export function makeLinking(isSignedIn) {
  return {
    prefixes: ['nascon://'],
    getStateFromPath(path) {
      const signedIn = isSignedIn();
      const [kind, rawId] = path.replace(/^\/+/, '').split(/[/?#]/);
      const id = decodeURIComponent(rawId || '');
      const invite = (/[?&]invite=([^&#]+)/.exec(path) || [])[1];
      if (!id) return undefined;
      let route;
      if (kind === 'stream' || (kind === 'entity' && id.startsWith('cs-session-'))) {
        route = { name: 'CoStream', params: invite ? { sessionId: id, invite: decodeURIComponent(invite) } : { sessionId: id } };
      } else if (kind === 'entity' && id.startsWith('club-')) {
        route = signedIn ? { name: 'ClubDetail', params: { clubId: id, title: 'Club' } } : { name: 'Web', params: { path: `/web/clubs/${id}`, title: 'Club' } };
      } else if (kind === 'entity' && id.startsWith('player-')) {
        route = signedIn ? { name: 'Athlete', params: { playerId: id, title: 'Athlete' } } : { name: 'Web', params: { path: `/web/players/${id}`, title: 'Athlete' } };
      } else if (kind === 'entity') {
        route = { name: 'Match', params: { matchId: id, title: 'Match' } };
      }
      if (!route) return undefined;
      return { routes: [{ name: signedIn ? 'Main' : 'Login' }, route] };
    },
  };
}

// Where a scanned QR (or entity id) should go inside the app.
export function routeForEntity(type, id, signedIn) {
  if (type === 'costream') return ['CoStream', { sessionId: id }];
  if (type === 'club') return signedIn ? ['ClubDetail', { clubId: id, title: 'Club' }] : ['Web', { path: `/web/clubs/${id}`, title: 'Club' }];
  if (type === 'player') return signedIn ? ['Athlete', { playerId: id, title: 'Athlete' }] : ['Web', { path: `/web/players/${id}`, title: 'Athlete' }];
  return ['Match', { matchId: id, title: 'Match' }];
}
