import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { block, listBlocks, updateMe } from "../services/usersService";
import { uploadImage } from "../services/mediaService";
import { changePassword } from "../services/authService";
import { Avatar, Page } from "../components/ui";
export default function Settings() {
  const { user, updateUser, logout } = useAuth(); const toast = useToast(); const nav = useNavigate();
  const [name, setName] = useState(user.displayName); const [bio, setBio] = useState(user.bio || ""); const [busy, setBusy] = useState(false); const [blocked, setBlocked] = useState([]);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  useEffect(() => { listBlocks().then((r) => setBlocked(r.items)).catch(() => {}); }, []);
  const save = async () => { setBusy(true); try { updateUser(await updateMe({ displayName: name, bio })); toast("Saved", "info"); } catch (e) { toast(e.message); } finally { setBusy(false); } };
  const pick = async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const url = await uploadImage(f, "avatar"); updateUser(await updateMe({ avatarUrl: url })); } catch (err) { toast(err.message); } };
  const unblock = async (id) => { setBlocked((p) => p.filter((u) => u.id !== id)); try { await block(id, false); } catch (e) { toast(e.message); } };
  const savePassword = async () => {
    if (pw.next.length < 8) return toast("New password must be at least 8 characters");
    if (pw.next !== pw.confirm) return toast("The new passwords do not match");
    setPwBusy(true);
    try {
      const d = await changePassword(pw.current, pw.next);
      if (d?.user) updateUser(d.user);
      setPw({ current: "", next: "", confirm: "" });
      toast("Password changed — other devices were signed out", "info");
    } catch (e) { toast(e.message); } finally { setPwBusy(false); }
  };
  return (
    <Page><h1 className="text-lg font-bold">Settings</h1>
      <label className="flex items-center gap-4"><Avatar user={user} size={64} /><span className="text-sm text-indigo-600">Change photo</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={pick} className="hidden" /></label>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className="w-full rounded-xl border px-3 py-3" />
      <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} rows={3} placeholder="Bio" className="w-full rounded-xl border px-3 py-3" />
      <button onClick={save} disabled={busy || !name.trim()} className="w-full rounded-xl bg-indigo-600 py-3 font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>

      <h2 className="font-semibold pt-2">Change password</h2>
      <div className="space-y-2">
        <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} placeholder="Current password" className="w-full rounded-xl border px-3 py-2.5 text-sm" />
        <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="New password (min 8 characters)" className="w-full rounded-xl border px-3 py-2.5 text-sm" />
        <input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} placeholder="Confirm new password" className="w-full rounded-xl border px-3 py-2.5 text-sm" />
        <button onClick={savePassword} disabled={pwBusy || !pw.current || pw.next.length < 8} className="w-full rounded-xl border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50">{pwBusy ? "Updating…" : "Update password"}</button>
      </div>

      <h2 className="font-semibold pt-2">Blocked users</h2>
      {!blocked.length ? <p className="text-sm text-gray-400">No blocked users.</p> : blocked.map((u) => <div key={u.id} className="flex items-center justify-between text-sm"><span>@{u.handle}</span><button onClick={() => unblock(u.id)} className="text-indigo-600">Unblock</button></div>)}
      {user.roles?.includes("admin") && <button onClick={() => nav("/admin")} className="w-full rounded-xl border py-3 text-sm">Admin dashboard</button>}
      <button onClick={logout} className="w-full rounded-xl border py-3 text-sm text-red-600">Log out</button>
    </Page>
  );
}
