import { useEffect, useState } from "react";
import { googleAvailable, googleStartUrl } from "../services/authService";

// Availability is a server property, not per-render state: resolve it once per page load.
let cached = null;
const availability = () => (cached ??= googleAvailable().catch(() => ({ enabled: false })));
/** Path prefix the server tells us to start from (matches the registered redirect URI). */
const DEFAULT_START_PATH = "/auth/google/start";

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

/**
 * Starts the Google OAuth flow with a full-page navigation (the backend replies 302 to Google's
 * consent screen). Renders a disabled, explained button when the server has no OAuth client
 * configured, so it is never a control that silently does nothing.
 */
export default function GoogleButton({ from = "/", label = "Continue with Google" }) {
  const [enabled, setEnabled] = useState(null);
  const [startPath, setStartPath] = useState(DEFAULT_START_PATH);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    availability().then((r) => {
      if (!alive) return;
      setEnabled(!!r?.enabled);
      if (r?.startPath) setStartPath(r.startPath);
    });
    return () => { alive = false; };
  }, []);

  const go = () => { setBusy(true); window.location.assign(googleStartUrl(from, startPath)); };
  const off = enabled === false;

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy || enabled === null || off}
      aria-busy={busy || enabled === null}
      title={off ? "Google sign-in is not configured on this server" : undefined}
      className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <GoogleMark />
      {busy ? "Redirecting to Google…" : enabled === null ? "Checking Google sign-in…" : label}
    </button>
  );
}

export function OrDivider({ text = "or" }) {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-gray-200" />
      <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{text}</span>
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}
