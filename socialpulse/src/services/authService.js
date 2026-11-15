import api, { API_BASE, unwrap, fail } from "./api";
import { getRefreshToken, setSession } from "./session";
const store = (d) => { setSession(d); return d; };
export const login = (identifier, password) => api.post("/auth/login", { identifier, password }).then(unwrap).then(store).catch(fail);
export const register = (b) => api.post("/auth/register", b).then(unwrap).then(store).catch(fail);
export const logout = async () => { const refreshToken = getRefreshToken(); try { if (refreshToken) await api.post("/auth/logout", { refreshToken }); } catch { /* best effort */ } setSession(null); };
export const me = () => api.get("/users/me").then(unwrap).catch(fail);
// Email verification (token comes from the emailed link).
export const verifyEmail = (token) => api.post("/auth/verify-email", { token }).then(unwrap).catch(fail);
export const resendVerification = () => api.post("/auth/resend-verification").then(unwrap).catch(fail);
// Password reset. forgotPassword never reveals whether the address exists.
export const forgotPassword = (email) => api.post("/auth/forgot-password", { email }).then(unwrap).catch(fail);
export const resetPassword = (token, password) => api.post("/auth/reset-password", { token, password }).then(unwrap).catch(fail);
// Signed-in change. The server revokes every other session and returns a fresh token pair, so the
// device that made the change stays signed in.
export const changePassword = (currentPassword, newPassword) => api.patch("/auth/password", { currentPassword, newPassword }).then(unwrap).then(store).catch(fail);
// Google sign-in. `start` is a full-page navigation (it 302s to Google), so it is a plain URL.
export const googleAvailable = () => api.get("/auth/google/available").then(unwrap).catch(fail);
const DEFAULT_START_PATH = "/auth/google/start";

/**
 * Full-page URL that starts the OAuth flow.
 *
 * The path prefix must match the one the server used to scope the signed state cookie (see
 * GoogleService.cookiePath / pathPrefix). If it does not, the browser never stores the cookie and
 * the callback fails with MISSING_STATE. The server tells us the correct startPath via
 * GET /auth/google/available; the button always uses that, falling back to the bare path only when
 * the availability endpoint is unreachable.
 */
export const googleStartUrl = (from, startPath = DEFAULT_START_PATH) => {
  const path = String(startPath ?? DEFAULT_START_PATH).replace(/\/+$/, "");
  return `${API_BASE}${path}${from && from !== "/" ? `?from=${encodeURIComponent(from)}` : ""}`;
};

export const googleExchange = (ticket) => api.post("/auth/google/exchange", { ticket }).then(unwrap).then(store).catch(fail);

export const googleAuthUrl = () => `${API_BASE}/auth/google/start`;
