import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verifyEmail } from "../services/authService";
import { Logo } from "../layouts/AppLayout";

/** Lands here from the emailed link: /verify-email?token=... */
export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [state, setState] = useState(token ? "working" : "missing");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) return;
    verifyEmail(token)
      .then(() => setState("done"))
      .catch((e) => { setState("error"); setMessage(e.message); });
  }, [token]);

  const copy = {
    working: ["Verifying your email…", "Hang on a moment."],
    done: ["Email confirmed", "Your address is verified. You can sign in now."],
    missing: ["This link is incomplete", "Open the link from your verification email again."],
    error: ["We couldn't verify that link", message || "The link may have expired or already been used."],
  }[state];

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="flex justify-center"><Logo size={48} /></div>
        <h1 className="text-xl font-bold">{copy[0]}</h1>
        <p className="text-sm text-gray-500">{copy[1]}</p>
        <p className="text-sm">
          <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">Go to sign in</Link>
        </p>
      </div>
    </div>
  );
}
