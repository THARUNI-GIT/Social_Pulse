import { useState } from "react";
import { Link } from "react-router-dom";
import { forgotPassword } from "../services/authService";
import { Logo } from "../layouts/AppLayout";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const r = await forgotPassword(email.trim().toLowerCase());
      setSent(true);
      // Present only when the server runs with AUTH_DEV_RETURN_LINKS=true (local development).
      if (r?.devLink) setDevLink(r.devLink);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Reset your password</h1>
          <p className="mt-1 text-sm text-gray-500">We'll email you a single-use reset link.</p>
        </div>
        {sent ? (
          <div className="space-y-3 rounded-2xl border border-gray-200/70 bg-white/90 p-5 text-center shadow-card">
            <p className="text-sm">If that address has an account, a reset link is on its way. It expires in 1 hour.</p>
            {devLink && (
              <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800 break-all">
                <b>Dev mode:</b> <a href={devLink} className="underline">open the reset link</a>
              </p>
            )}
            <Link to="/login" className="block text-sm font-medium text-indigo-600 hover:text-indigo-500">Back to sign in</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 rounded-2xl border border-gray-200/70 bg-white/90 p-5 shadow-card">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="email" className="field" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button disabled={busy || !email} className="btn-primary">{busy ? "Sending…" : "Send reset link"}</button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-gray-500">
          Remembered it? <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
