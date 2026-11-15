import { useEffect, useRef, useState } from "react";
import { ImagePlus, Send, X } from "lucide-react";
import { uploadMedia } from "../../services/mediaService";

// Re-send typing:start at most this often while keys keep coming, and stop after a short idle
// spell. The server independently auto-stops, so a dropped stop event can never stick.
const TYPING_REFRESH_MS = 1500;
const TYPING_IDLE_MS = 2500;
// Mirrors the media-service cap for `kind: post`; the server enforces it again.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export default function MessageInput({ onChange, onSend, onTyping }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const textRef = useRef(null);
  const stopTimer = useRef(null);
  const lastStart = useRef(0);
  // The unmount cleanup must use the CURRENT conversation's callback, not the one captured on
  // mount (which may belong to a conversation the user has since left).
  const typingCb = useRef(onTyping);
  const typingSent = useRef(false);
  typingCb.current = onTyping;

  const stopTyping = () => {
    clearTimeout(stopTimer.current);
    lastStart.current = 0;
    typingSent.current = false;
    typingCb.current?.(false);
  };

  const startTyping = () => {
    lastStart.current = Date.now();
    typingSent.current = true;
    typingCb.current?.(true);
  };

  // Grow with the content (up to a cap) so long messages are readable before sending.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [text]);

  // Leaving the page / switching chats mid-sentence must not leave "typing…" behind.
  useEffect(() => () => {
    clearTimeout(stopTimer.current);
    if (typingSent.current) typingCb.current?.(false);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    onChange?.(val);
    if (!val.trim()) { stopTyping(); return; }
    if (Date.now() - lastStart.current > TYPING_REFRESH_MS) startTyping();
    clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      lastStart.current = 0;
      typingSent.current = false;
      typingCb.current?.(false);
    }, TYPING_IDLE_MS);
  };

  const pick = (e) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = ""; // allow picking the same file again after removing it
    if (!f) return;
    if (!f.type.startsWith("image/")) { setError("Only images can be attached."); return; }
    if (f.size > MAX_IMAGE_BYTES) { setError(`That image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024}MB).`); return; }
    setError("");
    setFile(f);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (uploading) return;
    const trimmed = text.trim();
    if (!trimmed && !file) return;
    stopTyping();
    let mediaUrls;
    if (file) {
      setUploading(true);
      try {
        mediaUrls = [await uploadMedia(file, "post")];
      } catch (err) {
        setError(err.message);
        setUploading(false);
        return;
      }
    }
    onSend?.(trimmed, mediaUrls);
    setText("");
    onChange?.("");
    setFile(null);
    setUploading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="border-t bg-white">
      {file && (
        <div className="flex items-center gap-2 px-3 pt-2">
          <img src={URL.createObjectURL(file)} alt="" className="h-14 w-14 rounded-lg object-cover" />
          <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">{file.name}</span>
          <button type="button" onClick={() => setFile(null)} className="text-gray-400 hover:text-red-600" title="Remove attachment">
            <X size={14} />
          </button>
        </div>
      )}
      {error && <p className="px-3 pt-1 text-[11px] text-red-600">{error}</p>}
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-xl p-2 text-gray-500 transition hover:bg-indigo-50 hover:text-indigo-600"
          title="Attach an image"
        >
          <ImagePlus size={16} />
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={pick} className="hidden" />
        <textarea
          ref={textRef}
          value={text}
          onChange={handleChange}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline (and keeps the typing indicator alive).
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Type a message..."
          className="max-h-32 flex-1 resize-none rounded-xl border px-3 py-2 text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={uploading || (!text.trim() && !file)}
          className="p-2 rounded-xl bg-indigo-600 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 transition"
          title={uploading ? "Uploading…" : "Send"}
        >
          <Send size={14} />
        </button>
      </div>
    </form>
  );
}
