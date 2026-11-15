/**
 * Drives a second real user (bob) so the browser can show presence + typing.
 * Usage: node scripts/typing-demo.mjs [seconds]
 */
import { io } from "socket.io-client";
const B = process.env.GATEWAY ?? "http://localhost:8180";
const runFor = Number(process.argv[2] ?? 25) * 1000;

const call = async (path, { method = "GET", token, body } = {}) => {
  const r = await fetch(B + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!j.success) throw new Error(`${path}: ${j.error?.message ?? r.status}`); return j.data;
};
const login = (h) => call("/auth/login", { method: "POST", body: { identifier: h, password: "password123" } });

const alice = await login("alice");
const bob = await login("bob");
const conv = await call(`/conversations/direct/${alice.user.id}`, { method: "POST", token: bob.accessToken });

const sock = io(B, { auth: { token: bob.accessToken }, transports: ["polling", "websocket"] });
sock.on("connect", () => {
  console.log(`bob connected; typing in ${conv.id} for ${runFor / 1000}s`);
  const start = () => sock.emit("message:typing:start", { conversationId: conv.id });
  start();
  const t = setInterval(start, 2000); // below the 5s server auto-stop
  setTimeout(() => {
    clearInterval(t);
    sock.emit("message:typing:stop", { conversationId: conv.id });
    // Stay connected so the online dot remains visible until the process is killed.
    console.log("typing stopped; staying online");
  }, Math.max(2000, runFor - 3000));
});
sock.on("connect_error", (e) => { console.error("socket error:", e.message); process.exit(1); });
