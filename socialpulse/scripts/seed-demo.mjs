#!/usr/bin/env node
/**
 * Demo data for SocialPulse — safe to run repeatedly.
 *
 *   cd socialpulse && GATEWAY=http://localhost:8180 node scripts/seed-demo.mjs
 *
 * It creates 5-6 people with uploaded avatars, 10-12 posts whose images are really uploaded to the
 * media bucket (so nothing hotlinks and nothing 404s), comments, likes, one already-reported post
 * for the admin queue, one direct chat with history and one group chat with 3+ members.
 *
 * Images are generated locally as PNGs (no network, no dependencies) and uploaded through the same
 * presign flow the browser uses, so the allowlist and bucket policy stay intact.
 *
 * Nothing is deleted here: run scripts/reset-demo-data.sh first if you want a clean slate.
 */
import zlib from "node:zlib";
import { io } from "socket.io-client";

const G = process.env.GATEWAY || "http://localhost:8180";
const PASSWORD = "password123";

// ---------------------------------------------------------------- tiny PNG writer
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** 800x600 JPEG-ish gradient with a soft light blob and subtle bands — looks like a real photo tile. */
function makePng(w, h, seed = 0) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1); raw[off] = 0;
    const t = y / h;
    for (let x = 0; x < w; x++) {
      const dx = (x - w / 2) / w, dy = (y - h / 2) / h;
      const glow = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 2.4);
      const band = Math.sin((x + y) * 0.015 + seed) * 10 + Math.sin(x * 0.004 + seed) * 8;
      const r = 42 + 120 * t + glow * 95 + band;
      const g = 58 + 95 * (1 - t) + glow * 80 + band * 0.8;
      const b = 150 - 45 * t + glow * 70 + band * 0.6;
      raw[off + 1 + x * 3] = Math.max(0, Math.min(255, Math.round(r)));
      raw[off + 2 + x * 3] = Math.max(0, Math.min(255, Math.round(g)));
      raw[off + 3 + x * 3] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- HTTP helpers
const call = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(G + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json?.error?.message ?? ""}`);
  return json.data ?? json;
};
const login = (identifier) => call("/auth/login", { method: "POST", body: { identifier, password: PASSWORD } });
const register = (u) => call("/auth/register", { method: "POST", body: { ...u, password: PASSWORD } });

async function ensureUser({ handle, email, displayName }) {
  try {
    return { ...(await login(handle)), handle, created: false };
  } catch {
    const d = await register({ handle, email, displayName });
    return { ...d, handle, created: true };
  }
}

/** Presign -> multipart POST (fields first, file LAST) -> public URL. */
async function upload(token, buffer, name, kind = "post") {
  const p = await call("/media/uploads", { method: "POST", token, body: { kind, contentType: "image/png", size: buffer.length } });
  const fd = new FormData();
  for (const [k, v] of Object.entries(p.fields)) fd.append(k, v);
  fd.append("file", new Blob([buffer], { type: "image/png" }), name);
  const r = await fetch(p.uploadUrl, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload ${name} -> ${r.status} ${(await r.text()).slice(0, 80)}`);
  return p.publicUrl;
}

// ---------------------------------------------------------------- socket helper
function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(G, { auth: { token }, transports: ["websocket"], reconnection: false });
    const t = setTimeout(() => reject(new Error("socket connect timeout")), 8000);
    s.on("connect", () => { clearTimeout(t); resolve(s); });
    s.on("connect_error", (e) => { clearTimeout(t); reject(e); });
  });
}
// The gateway's SendDto expects `content` (the UI maps text -> content); sending `text` is rejected.
const send = (s, conversationId, content) => new Promise((resolve) => s.emit("message:send", { conversationId, content }, resolve));

// ---------------------------------------------------------------- seed
const PEOPLE = [
  { handle: "alice", email: "alice@socialpulse.dev", displayName: "Alice Rivera", bio: "Product designer. Coffee, cameras, coastlines." },
  { handle: "bob", email: "bob@socialpulse.dev", displayName: "Bob Chen", bio: "Backend engineer. I make APIs and flat whites." },
  { handle: "carol", email: "carol@socialpulse.dev", displayName: "Carol Singh", bio: "Travel writer. Always planning the next train." },
  { handle: "dave", email: "dave@socialpulse.dev", displayName: "Dave Okafor", bio: "Runner, cook, occasional photographer." },
  { handle: "emma", email: "emma@socialpulse.dev", displayName: "Emma Lindqvist", bio: "Illustrator in Stockholm. Sketches daily." },
  { handle: "frank", email: "frank@socialpulse.dev", displayName: "Frank Moreau", bio: "Cyclist and amateur baker." },
];

const POSTS = [
  ["alice", "Golden hour on the coast path. Worth the 6am start. #travel", 0],
  ["bob", "Finally shaved 200ms off the feed query. Indexes are underrated. #dev", 1],
  ["carol", "Small towns, long lunches, no itinerary. The best kind of week. #travel", 2],
  ["dave", "Sunday loaf number four. Crumb is finally where I want it. #baking", 3],
  ["emma", "Ink study for a children's book cover — five foxes and one very patient cat. #art", 4],
  ["frank", "Climbed the ridge before work. Legs are gone, view was worth it. #cycling", 5],
  ["alice", "New workspace, same three plants. #design", 6],
  ["bob", "Coffee, then code review. In that order, always. #dev", 7],
  ["carol", "Night train to the mountains. The sleeper carriage is criminally underrated. #travel", 0],
  ["emma", "Colour tests for the spring palette. #art", 1],
  ["dave", "Market haul: tomatoes, basil, too much garlic again. #baking", 2],
  ["frank", "Sunset from the saddle. #cycling", 3],
];

const run = async () => {
  console.log("seeding demo data →", G);
  const users = {};
  for (const p of PEOPLE) {
    const u = await ensureUser(p);
    users[p.handle] = u;
    console.log(`  ${u.created ? "created" : "exists "} @${p.handle}`);
  }
  const admin = await login("admin");

  // Blocks from earlier manual testing silently hide posts and reject chat messages between the
  // demo accounts. Clear them so a fresh seed always produces a coherent, interactive demo.
  for (const a of Object.keys(users)) {
    for (const b of Object.keys(users)) {
      if (a === b) continue;
      await call(`/users/${users[b].user.id}/block`, { method: "DELETE", token: users[a].accessToken }).catch(() => {});
    }
  }

  // Avatars: upload a distinct tile per person and persist it on the profile.
  for (const [i, p] of PEOPLE.entries()) {
    try {
      const url = await upload(users[p.handle].accessToken, makePng(256, 256, i * 1.7), `${p.handle}.png`, "avatar");
      await call("/users/me", { method: "PATCH", token: users[p.handle].accessToken, body: { avatarUrl: url } });
    } catch (e) { console.warn(`  avatar @${p.handle} skipped: ${e.message}`); }
  }

  // Posts with real uploaded images.
  const created = [];
  for (const [i, [handle, caption, seed]] of POSTS.entries()) {
    try {
      const mediaUrl = await upload(users[handle].accessToken, makePng(900, 700, seed + i), `post-${i}.png`);
      const post = await call("/posts", { method: "POST", token: users[handle].accessToken, body: { caption, visibility: "public", mediaUrls: [mediaUrl] } });
      created.push({ ...post, handle });
    } catch (e) { console.warn(`  post ${i} skipped: ${e.message}`); }
  }
  console.log(`  posts: ${created.length}`);

  // Comments + likes from other people.
  const authors = Object.keys(users);
  for (const [i, post] of created.entries()) {
    const other = authors.find((h) => h !== post.handle);
    try {
      await call(`/posts/${post.id}/comments`, { method: "POST", token: users[other].accessToken, body: { content: ["Love this.", "Great shot!", "Saving this one.", "How long did this take?"][i % 4] } });
      if (i % 2 === 0) await call(`/posts/${post.id}/comments`, { method: "POST", token: users[authors[(i + 2) % authors.length]].accessToken, body: { content: "Same here — really nice." } });
      await call(`/posts/${post.id}/reactions`, { method: "POST", token: users[authors[(i + 1) % authors.length]].accessToken, body: { reactionType: "like" } });
      if (i % 3 === 0) await call(`/posts/${post.id}/reactions`, { method: "POST", token: users[authors[(i + 3) % authors.length]].accessToken, body: { reactionType: "like" } });
    } catch (e) { console.warn(`  engagement ${i} skipped: ${e.message}`); }
  }

  // One post waiting in the admin queue (reported by bob, never by alice — her feed stays clean).
  const reportTarget = created.find((p) => p.handle === "alice") ?? created[0];
  if (reportTarget) {
    try {
      await call(`/posts/${reportTarget.id}/report`, { method: "POST", token: users.bob.accessToken, body: { reason: "misinformation", details: "Demo report: caption looks misleading." } });
      console.log(`  reported post: ${reportTarget.id.slice(0, 8)} (admin queue)`);
    } catch (e) { console.warn(`  report skipped: ${e.message}`); }
  }

  // Direct chat with history.
  try {
    const conv = await call(`/conversations/direct/${users.bob.user.id}`, { method: "POST", token: users.alice.accessToken });
    const a = await connect(users.alice.accessToken);
    const b = await connect(users.bob.accessToken);
    const lines = [
      ["alice", "Hey! Are we still on for the coast walk Saturday?"],
      ["bob", "Yes — forecast looks decent. 9am at the station?"],
      ["alice", "Perfect. I'll bring the good camera."],
      ["bob", "And I'll bring coffee. Two sugars, right?"],
      ["alice", "You remembered. See you Saturday!"],
    ];
    for (const [who, text] of lines) await send(who === "alice" ? a : b, conv.id, text);
    a.close(); b.close();
    console.log(`  direct chat: ${lines.length} messages`);
  } catch (e) { console.warn(`  direct chat skipped: ${e.message}`); }

  // Group chat with 3+ members.
  try {
    const grp = await call("/conversations/group", { method: "POST", token: users.alice.accessToken, body: { name: "Weekend Crew", memberIds: [users.bob.user.id, users.carol.user.id] } });
    const socks = { alice: await connect(users.alice.accessToken), bob: await connect(users.bob.accessToken), carol: await connect(users.carol.accessToken) };
    const lines = [
      ["alice", "Made a group so we stop losing plans in DMs."],
      ["bob", "Good call. Saturday 9am still works for me."],
      ["carol", "I'm in — can bring snacks."],
      ["alice", "Legend. I'll post the route tonight."],
    ];
    for (const [who, text] of lines) await send(socks[who], grp.id, text);
    Object.values(socks).forEach((s) => s.close());
    console.log(`  group chat: Weekend Crew (${grp.members?.length ?? 3} members)`);
  } catch (e) { console.warn(`  group chat skipped: ${e.message}`); }

  // A notification or two so the bell has something real in it.
  try {
    await call(`/users/${users.alice.user.id}/follow`, { method: "POST", token: users.carol.accessToken });
    await call(`/users/${users.bob.user.id}/follow`, { method: "POST", token: users.alice.accessToken });
    await call("/notifications/read-all", { method: "POST", token: admin.accessToken });
  } catch (e) { console.warn(`  follow/notify skipped: ${e.message}`); }

  console.log("done. accounts: alice / bob / carol / dave / emma / frank / admin — password:", PASSWORD);
};

run().catch((e) => { console.error("seed failed:", e.message); process.exit(1); });
