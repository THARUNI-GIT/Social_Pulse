import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resetPassword } from "../services/authService";
import { Logo } from "../layouts/AppLayout";

/** Lands here from the emailed link: /reset-password?token=... */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (pw !== confirm) { setError("Passwords don't match"); return; }
    setBusy(true); setError("");
    try { await resetPassword(token, pw); setDone(true); setTimeout(() => nav("/login", { replace: true }), 1500); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={48} />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Choose a new password</h1>
        </div>
        {!token ? (
          <p className="rounded-2xl border bg-white p-5 text-center text-sm text-gray-500">
            This reset link is incomplete. <Link to="/forgot-password" className="font-medium text-indigo-600">Request a new one.</Link>
          </p>
        ) : done ? (
          <p className="rounded-2xl border bg-white p-5 text-center text-sm">Password updated. Taking you to sign in…</p>
        ) : (
          <form onSubmit={submit} className="space-y-3 rounded-2xl border border-gray-200/70 bg-white/90 p-5 shadow-card">
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 8)" autoComplete="new-password" className="field" />
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" className="field" />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button disabled={busy || pw.length < 8 || !confirm} className="btn-primary">{busy ? "Saving…" : "Set new password"}</button>
          </form>
        )}
      </div>
    </div>
  );
}
