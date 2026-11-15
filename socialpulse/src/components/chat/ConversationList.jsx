import { Users } from "lucide-react";
import { SmartImage } from "../ui";

const timeLabel = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.floor((now - d) / 86400000);
  if (days < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

/** Group avatar: up to three member photos stacked, otherwise the group glyph. */
function GroupAvatar({ urls = [] }) {
  const shown = urls.filter(Boolean).slice(0, 3);
  if (!shown.length) {
    return (
      <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
        <Users size={17} />
      </div>
    );
  }
  return (
    <div className="relative h-10 w-10 shrink-0">
      {shown.slice(0, 3).map((url, i) => (
        <span
          key={url + i}
          className="absolute overflow-hidden rounded-full ring-2 ring-white"
          style={{
            width: shown.length === 1 ? 40 : 26,
            height: shown.length === 1 ? 40 : 26,
            left: i === 0 ? 0 : i === 1 ? 14 : 7,
            top: i === 0 ? 0 : i === 1 ? 0 : 14,
            zIndex: 3 - i,
          }}
        >
          <SmartImage src={url} className="h-full w-full" imgClassName="h-full w-full object-cover" />
        </span>
      ))}
    </div>
  );
}

export default function ConversationList({ users = [], activeId, onSelect, typingIds, unreadById = {} }) {
  if (!users.length) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm font-semibold text-gray-900">No conversations yet</p>
        <p className="mt-1 text-xs text-gray-500">Search for someone above to start a chat.</p>
      </div>
    );
  }

  return (
    <div className="divide-y">
      {users.map((u) => {
        const active = u.id === activeId;
        const typing = !!typingIds?.has(u.id);
        // Same server-provided number as the nav badge (never counted locally).
        const unread = unreadById[u.conversationId] ?? 0;
        const isGroup = u.type === "group";
        // Group previews name the sender; direct previews already read as the other person.
        const preview = u.lastMessage
          ? `${isGroup && u.lastSender ? `${u.lastSender}: ` : ""}${u.lastMessage}`
          : "";
        return (
          <button
            key={u.id || u.conversationId}
            onClick={() => onSelect(u)}
            className={`flex w-full items-center gap-3 p-3 text-left transition hover:bg-gray-50 ${active ? "border-l-4 border-indigo-600 bg-indigo-50/50" : ""}`}
          >
            <div className="relative shrink-0">
              {isGroup ? (
                <GroupAvatar urls={u.avatarUrls} />
              ) : u.avatarUrl ? (
                <SmartImage src={u.avatarUrl} className="h-10 w-10" imgClassName="h-10 w-10 rounded-full object-cover" />
              ) : (
                <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
                  {(u.name || "U").slice(0, 2).toUpperCase()}
                </div>
              )}
              {/* Online dot: only direct chats have a single presence to show. */}
              {!isGroup && u.online && (
                <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" aria-label="Online" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900">{u.name || u.id}</p>
                <span className="shrink-0 text-[10px] text-gray-400">{timeLabel(u.updatedAt)}</span>
                {unread > 0 && (
                  <span className="shrink-0 rounded-full bg-rose-500 px-1.5 text-center text-[10px] font-bold leading-4 text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </div>
              {typing ? (
                <p className="truncate text-[11px] font-medium text-indigo-600">{isGroup ? `${u.name} — someone is typing…` : "typing…"}</p>
              ) : preview ? (
                <p className="truncate text-[11px] text-gray-500">{preview}</p>
              ) : isGroup ? (
                <p className="truncate text-[11px] text-gray-400">{u.members?.length ?? 0} members · {u.admins?.length ?? 0} admin{(u.admins?.length ?? 0) === 1 ? "" : "s"}</p>
              ) : (
                <p className="truncate text-[11px] text-gray-400">@{u.handle || u.userId}</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
