import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { clearSession, loadSession, saveSession } from './session';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null });

  useEffect(() => {
    loadSession().then((s) => setState({ loading: false, user: s ? s.user : null }));
  }, []);

  const login = async (email, password) => {
    const r = await api('/api/v1/auth/login', { method: 'POST', body: { email, password }, auth: false });
    await saveSession(r.token, r.user);
    setState({ loading: false, user: r.user });
  };

  const logout = async () => {
    await clearSession();
    setState({ loading: false, user: null });
  };

  return <Ctx.Provider value={{ ...state, login, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

export const ROLE_LABEL = {
  super_admin: 'Platform Super-Admin',
  league_organizer: 'League Organizer',
  club_manager: 'Club Manager',
  player: 'Player',
  viewer: 'Viewer',
};
