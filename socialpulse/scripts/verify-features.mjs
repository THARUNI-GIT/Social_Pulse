/**
 * End-to-end verification for the requested feature sets.
 *
 *   A) Post moderation: report -> queue -> remove -> hidden -> restore -> reporter/author notified.
 *   A2) Comment moderation: same, plus restore with the post's comment count.
 *   B) Chat realtime: presence + typing delivered to the other participant only.
 *   C) Multi-tab presence: stay online until the LAST socket closes.
 *   D) Message receipts: delivered (✓✓) and read/seen propagate back to the sender.
 *
 * Usage: node scripts/verify-features.mjs   (stack up; gateway defaults to :8180)
 */
import { io } from "socket.io-client";

const B = process.env.GATEWAY ?? "http://localhost:8180";
const PASS = "password123";
let failures = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`PASS  ${name}${extra ? "  — " + extra : ""}`);
  else { failures++; console.log(`FAIL  ${name}${extra ? "  — " + extra : ""}`); }
};

async function call(path, { method = "GET", token, body } = {}) {
  const r = await fetch(B + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = {}; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: r.status, ok: json.success === true, data: json.data, error: json.error, raw: text };
}

const login = async (h) => {
  const r = await call("/auth/login", { method: "POST", body: { identifier: h, password: PASS } });
  if (!r.ok) throw new Error(`login ${h}: ${r.status} ${r.error?.message}`);
  return r.data;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modCount = async (token, re) => {
  const r = await call("/notifications?limit=50", { token });
  return (r.data?.items ?? []).filter((n) => n.type === "moderation" && re.test(n.preview ?? "")).length;
};

// ---------------------------------------------------------------- setup
const admin = await login("admin");
const alice = await login("alice");
const bob = await login("bob");
console.log(`signed in: admin=${admin.user.id.slice(0, 8)} alice=${alice.user.id.slice(0, 8)} bob=${bob.user.id.slice(0, 8)}\n`);

// ================================================================ A) POST MODERATION
console.log("--- A) post moderation ---");
const stamp = Date.now();
const post = await call("/posts", { method: "POST", token: alice.accessToken, body: { caption: `verify-report-target-${stamp}`, visibility: "public" } });
ok("alice creates a post", post.status === 201 && !!post.data?.id, `status ${post.status}`);
const postId = post.data.id;

const nonAdminReports = await call("/admin/reports", { token: alice.accessToken });
ok("non-admin blocked from /admin/reports", nonAdminReports.status === 403, `status ${nonAdminReports.status}`);

const report = await call(`/posts/${postId}/report`, { method: "POST", token: bob.accessToken, body: { reason: "spam", details: "automated verification" } });
ok("bob reports the post with a reason", report.status === 201 && !!report.data?.id, `status ${report.status}`);

// The reporter must never see the reported post again: server-side filter, not a UI hide.
const bobFeedAfterReport = await call("/posts?limit=50", { token: bob.accessToken });
ok("reported post disappears from the reporter's feed", !(bobFeedAfterReport.data?.items ?? []).some((p) => p.id === postId));
const bobRelogin = await login("bob");
const bobFeedRelogin = await call("/posts?limit=50", { token: bobRelogin.accessToken });
ok("reported post stays hidden after re-login", !(bobFeedRelogin.data?.items ?? []).some((p) => p.id === postId));
const aliceFeedAfterReport = await call("/posts?limit=50", { token: alice.accessToken });
ok("other users still see the reported post", (aliceFeedAfterReport.data?.items ?? []).some((p) => p.id === postId));

const queue = await call("/admin/reports?status=open", { token: admin.accessToken });
const row = (queue.data?.items ?? []).find((r) => r.targetId === postId);
ok("report appears in the admin open queue", !!row, `open=${queue.data?.items?.length ?? 0}`);
ok("queue row carries reason + status", row?.reason === "spam" && row?.status === "open");

const adminView = await call(`/admin/posts/${postId}`, { token: admin.accessToken });
ok("admin can open the reported post", adminView.ok && adminView.data?.caption?.includes(String(stamp)), `status ${adminView.status}`);
ok("admin view exposes media + removed flag", Array.isArray(adminView.data?.mediaUrls) && adminView.data?.removed === false);

const removed = await call(`/admin/reports/${row.id}/resolve`, { method: "POST", token: admin.accessToken, body: { action: "remove" } });
ok("admin removes the post", removed.ok && removed.data?.status === "resolved" && removed.data?.notified >= 1, `notified=${removed.data?.notified}`);

const publicGet = await call(`/posts/${postId}`, { token: bob.accessToken });
ok("removed post is hidden from normal routes (404)", publicGet.status === 404, `status ${publicGet.status}`);

const feed = await call("/posts?limit=50", { token: bob.accessToken });
ok("removed post is gone from the normal feed", !(feed.data?.items ?? []).some((p) => p.id === postId));

const adminAfter = await call(`/admin/posts/${postId}`, { token: admin.accessToken });
ok("admin can still see the removed post (removed=true)", adminAfter.data?.removed === true);

const history = await call("/admin/reports?status=resolved", { token: admin.accessToken });
const histRow = (history.data?.items ?? []).find((r) => r.targetId === postId);
ok("removal is kept in the resolved history", !!histRow && histRow.resolvedBy === admin.user.id);

await sleep(1800);
const bobNotes = await call("/notifications", { token: bob.accessToken });
const reporterNote = (bobNotes.data?.items ?? []).find((n) => n.type === "moderation" && /removed/i.test(n.preview ?? ""));
ok("reporter gets a moderation notification", !!reporterNote, reporterNote?.preview ?? "none");

const aliceNotes = await call("/notifications", { token: alice.accessToken });
const authorNote = (aliceNotes.data?.items ?? []).find((n) => n.type === "moderation" && /removed/i.test(n.preview ?? ""));
ok("author is notified the post was removed", !!authorNote, authorNote?.preview ?? "none");

const restored = await call(`/admin/posts/${postId}/restore`, { method: "POST", token: admin.accessToken });
ok("admin restores the post", restored.ok && restored.data?.restored === true, `status ${restored.status}`);

// Read as the author: the reporter still has it filtered out (by design), so bob would 404 here.
const visibleAgain = await call(`/posts/${postId}`, { token: alice.accessToken });
ok("restored post is visible again", visibleAgain.status === 200 && visibleAgain.data?.id === postId);

const adminFinal = await call(`/admin/posts/${postId}`, { token: admin.accessToken });
ok("admin view shows removed=false after restore", adminFinal.data?.removed === false);

await sleep(1800);
const aliceNotes2 = await call("/notifications", { token: alice.accessToken });
const restoreNote = (aliceNotes2.data?.items ?? []).find((n) => n.type === "moderation" && /restored/i.test(n.preview ?? ""));
ok("author is notified the post was restored", !!restoreNote, restoreNote?.preview ?? "none");

// ================================================================ A2) COMMENT MODERATION
console.log("\n--- A2) comment moderation ---");
const post2 = await call("/posts", { method: "POST", token: alice.accessToken, body: { caption: `verify-comment-target-${stamp}`, visibility: "public" } });
const comment = await call(`/posts/${post2.data.id}/comments`, { method: "POST", token: bob.accessToken, body: { content: `verify-comment-${stamp}` } });
ok("bob comments on the post", comment.status === 201 && !!comment.data?.id, `status ${comment.status}`);

const creport = await call(`/posts/${post2.data.id}/comments/${comment.data.id}/report`, { method: "POST", token: alice.accessToken, body: { reason: "hate", details: "comment verification" } });
ok("comment can be reported", creport.status === 201, `status ${creport.status}`);

const cq = await call("/admin/reports?status=open", { token: admin.accessToken });
const crow = (cq.data?.items ?? []).find((r) => r.targetId === comment.data.id);
ok("comment report appears in the queue", !!crow && crow.targetType === "comment");

const cview = await call(`/admin/comments/${comment.data.id}`, { token: admin.accessToken });
ok("admin can read the reported comment", cview.ok && cview.data?.content?.includes(String(stamp)) && cview.data?.removed === false, `status ${cview.status}`);

const beforeCommentRemoved = await modCount(bob.accessToken, /removed your comment/);
const cres = await call(`/admin/reports/${crow.id}/resolve`, { method: "POST", token: admin.accessToken, body: { action: "remove" } });
ok("admin removes the comment", cres.ok && cres.data?.status === "resolved", `status ${cres.status}`);

const threadGone = await call(`/posts/${post2.data.id}/comments`, { token: bob.accessToken });
ok("removed comment is hidden from the thread", !(threadGone.data?.items ?? []).some((c) => c.id === comment.data.id));

const cview2 = await call(`/admin/comments/${comment.data.id}`, { token: admin.accessToken });
ok("admin still sees the removed comment", cview2.data?.removed === true);

await sleep(1800);
const afterCommentRemoved = await modCount(bob.accessToken, /removed your comment/);
ok("comment author notified of removal", afterCommentRemoved === beforeCommentRemoved + 1, `${beforeCommentRemoved} -> ${afterCommentRemoved}`);

const beforeCommentRestored = await modCount(bob.accessToken, /restored your comment/);
const crest = await call(`/admin/comments/${comment.data.id}/restore`, { method: "POST", token: admin.accessToken });
ok("admin restores the comment", crest.ok && crest.data?.restored === true, `status ${crest.status}`);

const threadBack = await call(`/posts/${post2.data.id}/comments`, { token: bob.accessToken });
ok("restored comment is visible again", (threadBack.data?.items ?? []).some((c) => c.id === comment.data.id));

const cview3 = await call(`/admin/comments/${comment.data.id}`, { token: admin.accessToken });
ok("admin view shows removed=false after restore", cview3.data?.removed === false);

await sleep(1800);
const afterCommentRestored = await modCount(bob.accessToken, /restored your comment/);
ok("comment author notified of restore", afterCommentRestored === beforeCommentRestored + 1, `${beforeCommentRestored} -> ${afterCommentRestored}`);

// ================================================================ B) CHAT PRESENCE + TYPING
console.log("\n--- B) chat presence + typing ---");
const conv = await call(`/conversations/direct/${bob.user.id}`, { method: "POST", token: alice.accessToken });
ok("direct conversation exists", conv.ok && !!conv.data?.id, `status ${conv.status}`);
const convId = conv.data.id;

const presenceEvents = [];
const typingAtBob = [];
const typingAtAlice = [];
const messagesAtBob = [];

const connect = (token, tag) => new Promise((resolve, reject) => {
  const s = io(B, { auth: { token }, reconnection: false, transports: ["polling", "websocket"] });
  const t = setTimeout(() => reject(new Error(`${tag} socket timeout`)), 12000);
  s.on("connect", () => { clearTimeout(t); resolve(s); });
  s.on("connect_error", (e) => { clearTimeout(t); reject(new Error(`${tag} socket: ${e.message}`)); });
});

const bobSock = await connect(bob.accessToken, "bob");
bobSock.on("presence:update", (e) => { if (e.userId === alice.user.id) presenceEvents.push(e); });
bobSock.on("message:typing", (e) => { if (e.userId === alice.user.id) typingAtBob.push(e); });
bobSock.on("message:new", ({ message }) => { if (message.conversationId === convId) messagesAtBob.push(message); });
ok("bob socket connected", bobSock.connected);

await sleep(400);
const aliceSock = await connect(alice.accessToken, "alice");
aliceSock.on("message:typing", (e) => { if (e.userId === alice.user.id) typingAtAlice.push(e); });
ok("alice socket connected", aliceSock.connected);

await sleep(1200);
ok("bob receives alice online presence", presenceEvents.some((e) => e.status === "online"), JSON.stringify(presenceEvents));

const snap = await call(`/conversations/presence?userIds=${alice.user.id}`, { token: bob.accessToken });
ok("initial presence snapshot reports alice online", snap.data?.items?.[0]?.online === true, JSON.stringify(snap.data?.items));

aliceSock.emit("message:typing:start", { conversationId: convId });
await sleep(700);
ok("bob receives typing:start for the conversation", typingAtBob.some((e) => e.isTyping === true && e.conversationId === convId));
ok("sender does not receive their own typing event", typingAtAlice.length === 0, `alice events=${typingAtAlice.length}`);

aliceSock.emit("message:typing:stop", { conversationId: convId });
await sleep(700);
ok("bob receives typing:stop", typingAtBob.some((e) => e.isTyping === false));

aliceSock.emit("message:send", { conversationId: convId, content: `verify-message-${stamp}`, type: "text" });
await sleep(1200);
ok("bob receives the message over the socket", messagesAtBob.some((m) => (m.content ?? "").includes(String(stamp))), `count=${messagesAtBob.length}`);

const unread = await call("/conversations/unread", { token: bob.accessToken });
ok("bob has an unread count for the conversation", (unread.data?.byConversation?.[convId] ?? 0) >= 1, JSON.stringify(unread.data));

// ================================================================ D) DELIVERED / SEEN RECEIPTS
console.log("\n--- D) delivered + seen receipts ---");
const aliceThread = await call(`/conversations/${convId}/messages?limit=10`, { token: alice.accessToken });
const sentMsg = (aliceThread.data?.items ?? []).find((m) => (m.content ?? "").includes(String(stamp)));
ok("sender sees the stored message", !!sentMsg && sentMsg.status === "sent", `status=${sentMsg?.status}`);

const statusAtAlice = [];
const readAtAlice = [];
aliceSock.on("message:new", ({ message }) => { if (message.id === sentMsg.id && message.status) statusAtAlice.push(message.status); });
aliceSock.on("message:read:update", (e) => { if (e.messageId === sentMsg.id) readAtAlice.push(e); });

bobSock.emit("message:delivered", { messageId: sentMsg.id });
await sleep(1200);
ok("sender is told the message was delivered", statusAtAlice.includes("delivered"), `statuses=${JSON.stringify(statusAtAlice)}`);

bobSock.emit("message:read", { conversationId: convId, messageId: sentMsg.id });
await sleep(1200);
ok("sender is told the message was read (seen tick)", readAtAlice.length >= 1, `events=${readAtAlice.length}`);

// ================================================================ B2) OFFLINE ON LAST SOCKET
aliceSock.disconnect();
await sleep(1500);
ok("bob receives alice offline presence", presenceEvents.some((e) => e.status === "offline"), JSON.stringify(presenceEvents.slice(-2)));
ok("offline event carries lastSeenAt", !!presenceEvents.find((e) => e.status === "offline")?.lastSeenAt);

const snap2 = await call(`/conversations/presence?userIds=${alice.user.id}`, { token: bob.accessToken });
ok("snapshot reports alice offline after disconnect", snap2.data?.items?.[0]?.online === false);

// ================================================================ C) MULTI-TAB PRESENCE
console.log("\n--- C) multi-tab presence ---");
const carol = await login("carol");
await call(`/conversations/direct/${carol.user.id}`, { method: "POST", token: bob.accessToken });
const carolPresence = [];
bobSock.on("presence:update", (e) => { if (e.userId === carol.user.id) carolPresence.push(e); });

const carol1 = await connect(carol.accessToken, "carol-tab-1");
await sleep(1000);
const carol2 = await connect(carol.accessToken, "carol-tab-2");
await sleep(1000);
ok("first tab announces carol online", carolPresence.filter((e) => e.status === "online").length === 1, JSON.stringify(carolPresence));
ok("second tab does not re-announce online", carolPresence.filter((e) => e.status === "online").length === 1);

carol1.disconnect();
await sleep(1600);
ok("closing one of two tabs keeps carol online", !carolPresence.some((e) => e.status === "offline"), JSON.stringify(carolPresence));
const snapTab1 = await call(`/conversations/presence?userIds=${carol.user.id}`, { token: bob.accessToken });
ok("snapshot still online with one tab left", snapTab1.data?.items?.[0]?.online === true);

carol2.disconnect();
await sleep(1600);
ok("closing the last tab publishes offline", carolPresence.some((e) => e.status === "offline"), JSON.stringify(carolPresence));
ok("offline after last tab carries lastSeenAt", !!carolPresence.find((e) => e.status === "offline")?.lastSeenAt);
const snapTab2 = await call(`/conversations/presence?userIds=${carol.user.id}`, { token: bob.accessToken });
ok("snapshot offline when every tab is closed", snapTab2.data?.items?.[0]?.online === false);

// ================================================================ E) CHAT UNREAD LIFECYCLE
// PRECONDITION: no other client may be signed in as the RECEIVING user while this runs. An open
// /chat tab for bob acknowledges the test messages first (correct app behaviour), so unread would
// legitimately read 0 and the delivered/seen checks would find the message already read.
// NOTE: the hidden-tab rule is CLIENT-SIDE ONLY and therefore manual-only here: Chat.jsx gates
// acknowledgement on document.visibilityState === "visible" && document.hasFocus(), which a socket
// script cannot change. Manual check: open /chat as bob in a tab, hide it (or focus another window),
// have alice send a message (badge must increase and stay), then show/focus the tab — the open
// conversation is acknowledged and its badge goes to 0. The checks below cover the server contract
// the client calls into (3 unread -> 0 on read, 0 on delivery while viewing).
console.log("\n--- E) chat unread lifecycle ---");

// Clear every conversation for bob so the total is deterministic.
const bobConvs = await call("/conversations", { token: bob.accessToken });
for (const c of bobConvs.data ?? []) await call(`/conversations/${c.id}/read`, { method: "POST", token: bob.accessToken });
const baseUnread = await call("/conversations/unread", { token: bob.accessToken });
ok("baseline unread is 0 for bob", baseUnread.data?.total === 0, JSON.stringify(baseUnread.data));

// A second tab of the same user: both must converge on the same server numbers.
const bobTab2 = await connect(bob.accessToken, "bob-tab-2");
const pushesTab1 = [];
const pushesTab2 = [];
bobSock.on("conversation:unread", (p) => pushesTab1.push(p));
bobTab2.on("conversation:unread", (p) => pushesTab2.push(p));

const alice2 = await connect(alice.accessToken, "alice-unread");
for (let i = 1; i <= 3; i++) {
  alice2.emit("message:send", { conversationId: convId, content: `unread-${stamp}-${i}`, type: "text" });
  await sleep(450);
}
await sleep(1600);

const three = await call("/conversations/unread", { token: bob.accessToken });
ok("per-conversation unread = 3", three.data?.byConversation?.[convId] === 3, JSON.stringify(three.data));
ok("total unread = 3", three.data?.total === 3, `total=${three.data?.total}`);
ok("delivery pushed the count to tab 1", pushesTab1.at(-1)?.total === 3, JSON.stringify(pushesTab1.at(-1)));
ok("delivery pushed the count to tab 2", pushesTab2.at(-1)?.total === 3, JSON.stringify(pushesTab2.at(-1)));

const readRes = await call(`/conversations/${convId}/read`, { method: "POST", token: bob.accessToken });
ok("mark-read answers with authoritative 0", readRes.data?.total === 0 && !readRes.data?.byConversation?.[convId], JSON.stringify(readRes.data));
await sleep(700);
const zero = await call("/conversations/unread", { token: bob.accessToken });
ok("unread is 0 after opening the conversation", zero.data?.total === 0, JSON.stringify(zero.data));
ok("both tabs got the 0 push", pushesTab1.at(-1)?.total === 0 && pushesTab2.at(-1)?.total === 0, `tab1=${pushesTab1.at(-1)?.total} tab2=${pushesTab2.at(-1)?.total}`);

// While the thread is open the client acknowledges each arrival (Chat.jsx on message:new).
let threadOpen = true;
bobSock.on("message:new", async ({ message }) => {
  if (threadOpen && message?.conversationId === convId && message.senderId !== bob.user.id) {
    await call(`/conversations/${convId}/read`, { method: "POST", token: bob.accessToken });
  }
});
alice2.emit("message:send", { conversationId: convId, content: `open-thread-${stamp}`, type: "text" });
await sleep(1800);
const stillZero = await call("/conversations/unread", { token: bob.accessToken });
ok("message while the thread is open keeps unread at 0", stillZero.data?.total === 0, JSON.stringify(stillZero.data));

threadOpen = false;
alice2.disconnect();
bobTab2.disconnect();

// ================================================================ E2) NOTIFICATION UNREAD LIFECYCLE
console.log("\n--- E2) notification unread lifecycle ---");
await call("/notifications/read-all", { method: "POST", token: bob.accessToken });
await sleep(900);
const nBase = await call("/notifications/unread-count", { token: bob.accessToken });
ok("notification baseline is 0", nBase.data?.count === 0, `count=${nBase.data?.count}`);

const bobPost = await call("/posts", { method: "POST", token: bob.accessToken, body: { caption: `unread-notif-${stamp}`, visibility: "public" } });
for (let i = 1; i <= 3; i++) {
  await call(`/posts/${bobPost.data.id}/comments`, { method: "POST", token: alice.accessToken, body: { content: `notif-${stamp}-${i}` } });
}
await sleep(2800);
const n3 = await call("/notifications/unread-count", { token: bob.accessToken });
ok("3 new notifications are unread", n3.data?.count === 3, `count=${n3.data?.count}`);

const nList = await call("/notifications?limit=50", { token: bob.accessToken });
const unreadInList = (nList.data?.items ?? []).filter((n) => !n.read).length;
ok("bell count equals unread items in the list", unreadInList === n3.data?.count, `${unreadInList} vs ${n3.data?.count}`);

const allRead = await call("/notifications/read-all", { method: "POST", token: bob.accessToken });
ok("mark-all-read answers 0", allRead.data?.unread === 0, JSON.stringify(allRead.data));
await sleep(900);
const n0 = await call("/notifications/unread-count", { token: bob.accessToken });
ok("bell count is 0 after viewing", n0.data?.count === 0, `count=${n0.data?.count}`);
const nList0 = await call("/notifications?limit=50", { token: bob.accessToken });
ok("no unread items remain in the list", (nList0.data?.items ?? []).every((n) => n.read));

// A notification arriving while the list is open is acknowledged by the mounted page; emulate it.
await call(`/posts/${bobPost.data.id}/comments`, { method: "POST", token: alice.accessToken, body: { content: `notif-${stamp}-4` } });
await sleep(2600);
const nNew = await call("/notifications/unread-count", { token: bob.accessToken });
ok("a new notification is counted before it is viewed", nNew.data?.count >= 1, `count=${nNew.data?.count}`);
await call("/notifications/read-all", { method: "POST", token: bob.accessToken });
await sleep(500);
const nAck = await call("/notifications/unread-count", { token: bob.accessToken });
ok("viewing/acking returns the bell to 0", nAck.data?.count === 0, `count=${nAck.data?.count}`);

// Badge persistence: a fresh login (page refresh) must read the persisted count, not reuse memory.
const bobAgain = await login("bob");
const nLogin = await call("/notifications/unread-count", { token: bobAgain.accessToken });
ok("bell count after a fresh login is 0", nLogin.data?.count === 0, `count=${nLogin.data?.count}`);
const cLogin = await call("/conversations/unread", { token: bobAgain.accessToken });
ok("chat count after a fresh login is 0", cLogin.data?.total === 0, `total=${cLogin.data?.total}`);

bobSock.disconnect();

// ================================================================ F) POST SHARING
console.log("\n--- F) post sharing ---");
const shareTarget = await call("/posts", { method: "POST", token: alice.accessToken, body: { caption: `share-target-${Date.now()}`, visibility: "public" } });
const shareConv = await call(`/conversations/direct/${bob.user.id}`, { method: "POST", token: alice.accessToken });
const shareSock = io(process.env.GATEWAY || "http://localhost:8180", { auth: { token: alice.accessToken }, transports: ["websocket"] });
await new Promise((r) => shareSock.on("connect", r));
const shareAck = await new Promise((r) => shareSock.emit("post:share", { postId: shareTarget.data.id, conversationIds: [shareConv.data.id], content: "look at this" }, r));
ok("sharing creates a message in the target chat", shareAck?.ok === true && shareAck.sent === 1, JSON.stringify(shareAck));
const sharedList = await call(`/conversations/${shareConv.data.id}/messages`, { token: bob.accessToken });
const sharedMsg = (sharedList.data?.items ?? []).find((m) => m.post?.id === shareTarget.data.id);
ok("shared message carries the post id + snapshot", !!sharedMsg && /share-target/.test(sharedMsg.post.caption));
const goneAck = await new Promise((r) => shareSock.emit("post:share", { postId: "00000000-0000-4000-8000-000000000000", conversationIds: [shareConv.data.id] }, r));
ok("unavailable post is rejected", goneAck?.ok === false && goneAck.code === "POST_UNAVAILABLE", JSON.stringify(goneAck));
shareSock.disconnect();
const privateGroup = await call("/conversations/group", { method: "POST", token: alice.accessToken, body: { name: `Private ${Date.now()}`, memberIds: [bob.user.id] } });
const outsider = await call(`/conversations/${privateGroup.data.id}/members`, { token: carol.accessToken });
ok("non-member cannot read group members", outsider.status === 403, `status ${outsider.status}`);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
