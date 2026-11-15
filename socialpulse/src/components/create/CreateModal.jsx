import { useState } from "react";
import { X } from "lucide-react";
import { createPost } from "../../services/postsService";
import { uploadMedia } from "../../services/mediaService";

const VISIBILITY = { Everyone: "public", "Followers only": "followers"};
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime", "video/ogg"];
const MB = 1024 * 1024;
// Per-kind caps, mirrored from media-service `LIMITS` (avatar 2MB / post 8MB / video 50MB).
const MAX_IMAGE = 8 * MB;
const MAX_VIDEO = 50 * MB;
const isVideo = (f) => !!f && VIDEO_TYPES.includes(f.type);
/** Limit for the file being picked - derived from the candidate, never from the previous selection. */
const limitFor = (f) => (isVideo(f) ? MAX_VIDEO : MAX_IMAGE);
const kindFor = (f) => (isVideo(f) ? "video" : "post");

export default function CreateModal({ open, onClose, onCreated }) {
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [audience, setAudience] = useState("Everyone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  if (!open) return null;

  const video = isVideo(file);

  const pick = (e) => {
    const f = e.target.files?.[0] ?? null;
    setError("");
    if (!f) { setFile(null); return; }
    if (![...IMAGE_TYPES, ...VIDEO_TYPES].includes(f.type)) { setError("Unsupported file type. Images: JPEG, PNG, WebP, GIF. Videos: MP4, WebM, MOV, OGG."); setFile(null); return; }
    // Validate against THIS file's kind. Reading `maxBytes` from state would compare a freshly
    // picked video against the 8MB image cap, which is exactly the wrong-limit symptom.
    if (f.size > limitFor(f)) {
      setError(isVideo(f)
        ? `That video is too large (max ${MAX_VIDEO / MB}MB).`
        : `That image is too large (max ${MAX_IMAGE / MB}MB).`);
      setFile(null);
      return;
    }
    setFile(f);
  };

  const publish = async () => {
    setLoading(true); setError("");
    try {
      const tags = hashtags.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean);
      // Text-only posts send no mediaUrls at all, so the feed never invents an image for them.
      // The upload kind follows the file's own MIME type so a video gets the video limit.
      const mediaUrls = file ? [await uploadMedia(file, kindFor(file))] : undefined;
      const post = await createPost({ caption, hashtags: tags, visibility: VISIBILITY[audience], mediaUrls });
      setCaption(""); setHashtags(""); setAudience("Everyone"); setFile(null);
      onCreated?.(post); onClose();
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Create post</h2><button onClick={onClose}><X size={18} /></button></div>
        <textarea rows={4} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What's on your mind?" className="w-full rounded-xl border p-3 text-sm" />
        <input value={hashtags} onChange={(e) => setHashtags(e.target.value)} placeholder="Hashtags (space or comma separated)" className="w-full rounded-xl border px-3 py-2 text-sm" />
        <select value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-xl border px-3 py-2 text-sm">
          {Object.keys(VISIBILITY).map((k) => <option key={k}>{k}</option>)}
        </select>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/ogg" onChange={pick} className="w-full text-sm" />
        {file && (video
          ? <video src={URL.createObjectURL(file)} controls className="max-h-40 w-full rounded-xl bg-black" />
          : <img src={URL.createObjectURL(file)} alt="" className="max-h-40 rounded-xl object-cover" />)}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button onClick={publish} disabled={loading || (!caption.trim() && !hashtags.trim() && !file)} className="w-full rounded-xl bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-50">
          {loading ? "Publishing…" : "Publish"}
        </button>
      </div>
    </div>
  );
}
