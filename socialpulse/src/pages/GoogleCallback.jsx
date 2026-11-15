import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { googleExchange } from "../services/authService";
import { Logo } from "../layouts/AppLayout";

/** Human-readable copy for every code the backend can redirect back with. */
const ERRORS = {
  GOOGLE_NOT_CONFIGURED: "Google sign-in is not configured on the server. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI.",
  CONSENT_DENIED: "You cancelled the Google sign-in. Nothing was changed on your account.",
  ACCESS_DENIED: "Google refused the request. Check that the OAuth client allows this app.",
  MISSING_STATE: "That sign-in link was incomplete or had already been used. Please try again.",
  INVALID_STATE: "We could not verify that sign-in request. Please try again.",
  STATE_MISMATCH: "That sign-in request did not match this browser. Please try again.",
  MISSING_CODE: "Google did not return an authorization code. Please try again.",
  GOOGLE_EXCHANGE_FAILED: "Google rejected the authorization code. It may have expired — please try again.",
  GOOGLE_TOKEN_INVALID: "We could not verify the identity Google returned.",
  EMAIL_UNVERIFIED: "Your Google email address is not verified, so we cannot use it to sign in.",
  NO_EMAIL: "Google did not share an email address with us.",
  ACCOUNT_SUSPENDED: "This account is suspended. Contact an administrator.",
  INVALID_TOKEN: "That sign-in link has expired. Please try again.",
  TOKEN_USED: "That sign-in link was already used. Please try again.",
  TOKEN_EXPIRED: "That sign-in link expired. Please try again.",
  PROVIDER_ERROR: "Google reported an error for that sign-in. Please try again.",
  OAUTH_FAILED: "Sign-in with Google failed. Please try again.",
};

/** Lands here from Google: /auth/callback?ticket=… or /auth/callback?error=… */
export default function GoogleCallback() {
  const [params] = useSearchParams();
  const ticket = params.get("ticket") || "";
  const error = params.get("error") || "";
  const from = params.get("from") || "/";
  const { adopt } = useAuth();
  const nav = useNavigate();
  const [state, setState] = useState(ticket ? "working" : "error");
  const [message, setMessage] = useState(error ? ERRORS[error] || `Google sign-in failed (${error}).` : "This link is incomplete.");
  // React 18 StrictMode runs effects twice in dev; the ticket is single-use, so guard the exchange.
  const done = useRef(false);

  useEffect(() => {
    if (!ticket || done.current) return;
    done.current = true;
    googleExchange(ticket)
      .then((d) => {
        adopt(d);
        setState("done");
        nav(from.startsWith("/") ? from : "/", { replace: true });
      })
      .catch((e) => { setState("error"); setMessage(e?.message || ERRORS.OAUTH_FAILED); });
  }, [ticket, from, adopt, nav]);

  const heading = state === "working" ? "Signing you in…" : state === "done" ? "Signed in" : "We couldn't sign you in";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="flex justify-center"><Logo size={48} /></div>
        <h1 className="text-xl font-bold">{heading}</h1>
        {state === "working" ? (
          <p className="text-sm text-gray-500">Finishing the Google handshake…</p>
        ) : (
          <>
            <p className="text-sm text-gray-500">{message}</p>
            <p className="text-sm space-x-3">
              <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">Back to sign in</Link>
              <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">Create an account</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
