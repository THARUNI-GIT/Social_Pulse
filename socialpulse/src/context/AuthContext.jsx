import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as auth from "../services/authService";
import { getSession, getToken, setSession } from "../services/session";
import { resetSocket } from "../websocket/socket";

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  // Validate the stored session on boot. api.js refreshes an expired access token on the first
  // 401 and clears the session (firing "auth:logout") if the refresh fails.
  useEffect(() => {
    let alive = true;
    if (!getToken()) { setReady(true); return; }
    auth.me()
      .then((u) => { if (alive) setUser(u); })
      .catch(() => { /* session is gone or invalid - api.js already cleared it */ })
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // A forced logout (refresh token rejected) must also drop the realtime identity, otherwise the
  // socket keeps acting as the previous user until the tab is reloaded.
  useEffect(() => {
    const h = () => { setUser(null); resetSocket(); };
    window.addEventListener("auth:logout", h);
    return () => window.removeEventListener("auth:logout", h);
  }, []);

  const login = useCallback(async (identifier, password) => {
    const d = await auth.login(identifier, password); // stores { accessToken, refreshToken, user }
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (b) => {
    const d = await auth.register(b);
    setUser(d.user);
    return d.user;
  }, []);

  /** Adopts a session produced elsewhere (the Google OAuth callback page). */
  const adopt = useCallback((d) => {
    if (!d?.user) return null;
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    await auth.logout(); // best-effort server call, then clears the local session
    // Drop the socket before clearing the session: it authenticated with the old token, and a
    // later login in this tab must not inherit that identity.
    resetSocket();
    setUser(null);
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((prev) => {
      const next = { ...prev, ...patch };
      setSession({ ...getSession(), user: next });
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ user, ready, isAdmin: !!user?.roles?.includes("admin"), login, register, adopt, logout, updateUser }),
    [user, ready, login, register, adopt, logout, updateUser]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
