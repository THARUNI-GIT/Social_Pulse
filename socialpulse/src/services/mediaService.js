import api, { unwrap, fail } from "./api";
/** Presign -> POST straight to the media store (fields first, file LAST) -> returns the public URL. */
export async function uploadMedia(file, kind) {
  const resolved = kind ?? (file?.type?.startsWith("video/") ? "video" : "post");
  const p = await api.post("/media/uploads", { kind: resolved, contentType: file.type, size: file.size }).then(unwrap).catch(fail);
  const fd = new FormData(); Object.entries(p.fields).forEach(([k, v]) => fd.append(k, v)); fd.append("file", file);
  let r;
  try {
    r = await fetch(p.uploadUrl, { method: "POST", body: fd });
  } catch {
    // A TypeError here is almost always a CORS / mixed-content / DNS problem, not a bad file.
    throw new Error("Upload blocked by the browser (storage unreachable or CORS refused). Check MINIO_PUBLIC_URL and the storage CORS origins.");
  }
  if (!r.ok) {
    const detail = (await r.text().catch(() => "")).slice(0, 120);
    throw new Error(`Upload rejected by storage (${r.status})${detail ? `: ${detail}` : ""}`);
  }
  return p.publicUrl;
}
/** Kept for existing callers (avatars are always images). */
export const uploadImage = (file, kind = "post") => uploadMedia(file, kind);
