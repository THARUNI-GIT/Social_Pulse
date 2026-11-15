import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Search, Shield, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { resendVerification } from "../services/authService";
import ThemeToggle from "../components/ThemeToggle";

/** Brand mark: gradient tile with a pulse glyph. Shared by the header and the auth screens. */
export function Logo({ size = 30 }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-sm"
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M2 13h4l2.5-6 4 12 2.5-6H22" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/**
 * Nudges (never blocks) an account whose email is not confirmed yet, and can resend the link.
 * Dismissible: the choice is remembered per account, so the bar stops following you around the
 * demo without pretending the address is confirmed.
 */
function VerifyBanner() {
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [devLink, setDevLink] = useState("");
  const key = user?.id ? `sp_verify_dismissed:${user.id}` : null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try { setDismissed(!!key && localStorage.getItem(key) === "1"); } catch { setDismissed(false); }
  }, [key]);
  if (!user || user.verified || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try { if (key) localStorage.setItem(key, "1"); } catch { /* storage unavailable */ }
  };
  const resend = async () => {
    setBusy(true);
    try {
      const r = await resendVerification();
      toast(r?.sent ? "Verification email sent" : "Verification link generated (no SMTP configured)", "info");
      if (r?.devLink) setDevLink(r.devLink);
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="max-w-4xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-900">
        <span>Your email isn't verified yet.</span>
        <button onClick={resend} disabled={busy} className="font-semibold underline disabled:opacity-60">
          {busy ? "Sending…" : "Resend verification link"}
        </button>
        {devLink && <a href={devLink} className="font-semibold text-indigo-700 underline">Dev: open link</a>}
        <button
          onClick={dismiss}
          className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full text-amber-700/70 transition hover:bg-amber-100 hover:text-amber-900"
          aria-label="Dismiss verification notice"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default function AppLayout({ children }) {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen text-gray-900 flex flex-col">
      <header className="sticky top-0 z-30 border-b border-gray-200/70 bg-white/80 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2.5 group">
            <Logo />
            <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">
              SocialPulse
            </span>
          </Link>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            {isAdmin && (
              <Link to="/admin" className="icon-btn" title="Admin">
                <Shield size={18} />
              </Link>
            )}
            <Link to="/search" className="icon-btn" title="Search">
              <Search size={18} />
            </Link>
            {/* Chat lives in the bottom navigation; a second entry point here was redundant. */}
            <Link to={`/profile/${user?.id}`} className="flex items-center gap-2 rounded-full p-1 pr-2.5 transition hover:bg-indigo-50" title="Profile">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
                  {(user?.displayName || user?.handle || "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="hidden sm:block max-w-[10rem] truncate text-sm font-medium text-gray-700">
                {user?.displayName || user?.handle}
              </span>
            </Link>
            <button onClick={() => { logout(); navigate("/login"); }} className="icon-btn" title="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <VerifyBanner />

      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
