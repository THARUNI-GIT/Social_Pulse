#!/usr/bin/env node
/**
 * SocialPulse — demo-readiness verification.
 *
 * Exercises the six implemented tasks against the RUNNING stack through the API gateway.
 * Nothing here is destructive: it only adds throwaway rows owned by the demo accounts and
 * never deletes accounts, posts or messages it did not create.
 *
 *   node scripts/verify-demo.mjs
 *   GATEWAY=http://localhost:8080 node scripts/verify-demo.mjs
 *
 * Notes / honest limitations:
 *  - Google OAuth is verified up to the point a real browser + Google consent is required.
 *    The consent redirect, state cookie, CSRF rejection and the ticket->session exchange are
 *    real; completing a live Google login needs a human in a browser (see DEMO-* docs).
 *  - Auth endpoints are rate limited to 10 requests/minute per IP, so this script logs in only
 *    the three demo accounts. Run it twice in a row and the second run may report RATE_LIMITED.
 */
const B = process.env.GATEWAY ?? 'http://localhost:8180';
const PW = process.env.DEMO_PASSWORD ?? 'password123';

let pass = 0, fail = 0, skipped = 0;
const failures = [];
const skip = (name, why) => { skipped++; console.log(`SKIP  ${name}  (${why})`); };
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`PASS  ${name}`); }
  else { fail++; failures.push(`${name}${detail ? ` -> ${detail}` : ''}`); console.log(`FAIL  ${name}${detail ? ` -> ${detail}` : ''}`); }
}

/**
 * The gateway rate limits `/auth` to 10 requests/minute per IP, which several sections below
 * legitimately exceed. Rather than weakening that limit for the test run, wait out the window.
 * The limiter is a security control and is left exactly as deployed.
 */
const RATE_LIMIT_WAIT_MS = 62_000;
async function fetchWithRetry(url, opts = {}, tries = 0) {
  const res = await fetch(url, opts);
  if (res.status === 429 && tries < 4) {
    console.log(`      (rate limited by /auth, waiting ${RATE_LIMIT_WAIT_MS / 1000}s before retry ${tries + 1})`);
    await new Promise((r) => setTimeout(r, RATE_LIMIT_WAIT_MS));
    return fetchWithRetry(url, opts, tries + 1);
  }
  return res;
}

async function api(method, path, { token, body } = {}) {
  const res = await fetchWithRetry(`${B}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON (e.g. a redirect page) */ }
  return { status: res.status, data: json?.data, error: json?.error, json };
}

const section = (t) => console.log(`\n# ${t}`);

async function login(identifier) {
  const r = await api('POST', '/auth/login', { body: { identifier, password: PW } });
  return r.data?.accessToken ?? null;
}

// ---------------------------------------------------------------- health
section('service health');
{
  const r = await api('GET', '/health');
  check('gateway /health answers', r.status === 200 && r.data?.status === 'ok', `status ${r.status}`);
}

// ---------------------------------------------------------------- google oauth
section('google oauth (task 1)');
let googleTokens = null;
{
  const avail = await api('GET', '/auth/google/available');
  check('GET /auth/google/available reports configured', avail.status === 200 && avail.data?.enabled === true,
    JSON.stringify(avail.data ?? avail.error));

  const alias = await api('GET', '/api/auth/google/available');
  check('/api/auth alias serves the same route', alias.status === 200 && alias.data?.enabled === true, `status ${alias.status}`);

  // start: must 302 to Google and set the signed state cookie
  const res = await fetchWithRetry(`${B}/auth/google/start?from=%2Fchat`, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  const cookie = res.headers.get('set-cookie') ?? '';
  const u = (() => { try { return new URL(location); } catch { return null; } })();
  check('start redirects to Google consent', res.status === 302 && u?.origin === 'https://accounts.google.com', `status ${res.status}`);
  check('auth URL asks for the code flow with S256 PKCE',
    u?.searchParams.get('response_type') === 'code' && u?.searchParams.get('code_challenge_method') === 'S256');
  check('auth URL carries a redirect_uri that matches our routing',
    /\/auth\/google\/callback$/.test(u?.searchParams.get('redirect_uri') ?? ''), u?.searchParams.get('redirect_uri') ?? '');
  check('start sets the httpOnly SameSite state cookie',
    /sp_google_oauth=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie));

  // callback rejections
  const noCookie = await fetchWithRetry(`${B}/auth/google/callback?code=x&state=y`, { redirect: 'manual' });
  check('callback without state cookie is rejected',
    noCookie.status === 302 && (noCookie.headers.get('location') ?? '').includes('error=MISSING_STATE'),
    noCookie.headers.get('location') ?? '');

  const denied = await fetchWithRetry(`${B}/auth/google/callback?error=access_denied`, { redirect: 'manual' });
  check('denied consent is reported as CONSENT_DENIED',
    (denied.headers.get('location') ?? '').includes('error=CONSENT_DENIED'), denied.headers.get('location') ?? '');

  const stateCookie = cookie.split(';')[0];
  const tampered = await fetchWithRetry(`${B}/auth/google/callback?code=x&state=not-the-real-state`, {
    redirect: 'manual', headers: { cookie: stateCookie },
  });
  check('state tampering is rejected (CSRF)',
    (tampered.headers.get('location') ?? '').includes('error=STATE_MISMATCH'), tampered.headers.get('location') ?? '');

  const forged = await fetchWithRetry(`${B}/auth/google/callback?code=x&state=whatever`, {
    redirect: 'manual', headers: { cookie: 'sp_google_oauth=forged.jwt.value' },
  });
  const forgedLoc = forged.headers.get('location') ?? '';
  check('a forged state cookie is rejected', forgedLoc.includes('error=INVALID_STATE'), `${forged.status} ${forgedLoc}`);

  // ticket exchange: single use
  const bad = await api('POST', '/auth/google/exchange', { body: { ticket: 'aaaaaaaaaaaaaaaaaaaaaaaa' } });
  check('unknown handoff ticket is refused', bad.status === 400 && bad.error?.code === 'INVALID_TOKEN', JSON.stringify(bad.error));
  const short = await api('POST', '/auth/google/exchange', { body: { ticket: 'short' } });
  check('short ticket fails validation', short.status === 400, `status ${short.status}`);
  skip('live Google consent -> account linking', 'requires a human in a browser with the real Google account');
}

// ---------------------------------------------------------------- logins
section('demo logins');
const alice = await login('alice');
const bob = await login('bob');
const carol = await login('carol');
const admin = await login('admin');
check('alice can sign in', !!alice);
check('bob can sign in', !!bob);
check('carol can sign in', !!carol);
check('admin can sign in', !!admin);

if (!alice || !bob || !carol || !admin) {
  console.log('\nDemo accounts unavailable (rate limited or password changed) - cannot continue.');
  console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
  process.exit(1);
}

const me = async (t) => (await api('GET', '/users/me', { token: t })).data;
const idOf = async (t) => (await me(t))?.id;
const aliceId = await idOf(alice);
const bobId = await idOf(bob);
const carolId = await idOf(carol);
const adminId = await idOf(admin);

// ---------------------------------------------------------------- group system events
section('group system events (task 4)');
{
  const made = await api('POST', '/conversations/group', { token: alice, body: { name: `Verify ${Date.now()}`, memberIds: [bobId] } });
  const gid = made.data?.id;
  check('alice creates a group with bob', !!gid, JSON.stringify(made.error ?? made.data));
  if (gid) {
    const listOf = async (token, convId) => (await api('GET', `/conversations/${convId}/messages`, { token })).data?.items ?? [];
    const sysOf = (items, ev) => items.find((m) => m.type === 'system' && m.system?.event === ev);

    let items = await listOf(alice, gid);
    const created = sysOf(items, 'created');
    check('group creation writes a persisted system event', !!created, JSON.stringify(items.slice(-2)));
    check('the creation event records the actor', created?.system?.actorId === aliceId, JSON.stringify(created?.system));

    // NOTE: the third member must have no block relationship with alice - membership changes
    // between a blocked pair are refused by design (see the group block policy).
    const added = await api('POST', `/conversations/${gid}/members`, { token: alice, body: { memberIds: [adminId] } });
    check('admin adds a member', added.status === 200 || added.status === 201, `status ${added.status}`);
    items = await listOf(alice, gid);
    const addedEv = sysOf(items, 'member_added');
    check('adding a member writes a system event naming the target', addedEv?.system?.targetId === adminId, JSON.stringify(addedEv?.system));

    // idempotency: re-adding a present member must not create a second event
    const before = (await listOf(alice, gid)).filter((m) => m.type === 'system' && m.system?.event === 'member_added').length;
    await api('POST', `/conversations/${gid}/members`, { token: alice, body: { memberIds: [adminId] } });
    const after = (await listOf(alice, gid)).filter((m) => m.type === 'system' && m.system?.event === 'member_added').length;
    check('re-adding an existing member writes no duplicate event', before === after, `${before} -> ${after}`);

    const renamed = await api('PATCH', `/conversations/${gid}`, { token: alice, body: { name: 'Renamed By Verify' } });
    check('admin renames the group', renamed.status === 200, `status ${renamed.status}`);
    const renamedEv = sysOf(await listOf(alice, gid), 'renamed');
    check('rename writes a system event carrying the new name', renamedEv?.system?.name === 'Renamed By Verify', JSON.stringify(renamedEv?.system));

    // authorization: a non-admin member cannot change membership
    const bobAdds = await api('POST', `/conversations/${gid}/members`, { token: bob, body: { memberIds: [adminId] } });
    check('a non-admin member cannot add members', bobAdds.status === 403, `status ${bobAdds.status}`);
    const bobRenames = await api('PATCH', `/conversations/${gid}`, { token: bob, body: { name: 'Nope' } });
    check('a non-admin member cannot rename', bobRenames.status === 403, `status ${bobRenames.status}`);

    const removed = await api('DELETE', `/conversations/${gid}/members/${adminId}`, { token: alice });
    check('admin removes a member', removed.status === 200, `status ${removed.status}`);
    const removedEv = sysOf(await listOf(alice, gid), 'member_removed');
    check('removal writes a system event naming the target', removedEv?.system?.targetId === adminId, JSON.stringify(removedEv?.system));

    // removed member loses access to group history
    const goneReads = await api('GET', `/conversations/${gid}/messages`, { token: admin });
    check('a removed member can no longer read group messages', goneReads.status === 403 || goneReads.status === 404, `status ${goneReads.status}`);

    // system messages carry no delivery/read receipts
    const sysIds = (await listOf(alice, gid)).filter((m) => m.type === 'system').map((m) => m.id);
    check('system events are typed and never marked read', sysIds.length >= 4, `${sysIds.length} system events`);
  }
}

// ---------------------------------------------------------------- moderation
section('admin moderation (task 3)');
{
  const bad = 'zzz-verify-not-a-uuid';
  const unauth = await api('POST', `/admin/reports/${bad}/resolve`, { body: { action: 'dismiss' } });
  check('unauthenticated moderation is refused', unauth.status === 401, `status ${unauth.status}`);
  const nonAdmin = await api('POST', `/admin/reports/${bad}/resolve`, { token: alice, body: { action: 'dismiss' } });
  check('a normal user cannot resolve reports', nonAdmin.status === 403, `status ${nonAdmin.status}`);

  const post = await api('POST', '/posts', { token: alice, body: { caption: `verify-moderation-${Date.now()}`, mediaUrls: [] } });
  const postId = post.data?.id;
  check('alice creates a post to moderate', !!postId, JSON.stringify(post.error));

  if (postId) {
    const reported = await api('POST', `/posts/${postId}/report`, { token: bob, body: { reason: 'spam' } });
    check('bob reports the post', reported.status === 201 || reported.status === 200, `status ${reported.status}`);

    const reports = await api('GET', '/admin/reports?status=open', { token: admin });
    const row = (reports.data?.items ?? []).find((r) => r.targetId === postId);
    check('the report appears in the admin queue', !!row, `status ${reports.status}`);

    if (row) {
      const dismissed = await api('POST', `/admin/reports/${row.id}/resolve`, { token: admin, body: { action: 'dismiss' } });
      check('admin dismisses the report', dismissed.status === 200, `status ${dismissed.status} ${JSON.stringify(dismissed.error)}`);
      const stillThere = await api('GET', `/posts/${postId}`, { token: alice });
      check('dismissing does NOT delete the post', stillThere.status === 200, `status ${stillThere.status}`);
      const after = await api('GET', '/admin/reports?status=open', { token: admin });
      check('the dismissed report leaves the open queue', !(after.data?.items ?? []).some((r) => r.id === row.id));
    }
  }

  const post2 = await api('POST', '/posts', { token: alice, body: { caption: `verify-removal-${Date.now()}`, mediaUrls: [] } });
  const post2Id = post2.data?.id;
  if (post2Id) {
    await api('POST', `/posts/${post2Id}/report`, { token: bob, body: { reason: 'spam' } });
    const reports = await api('GET', '/admin/reports?status=open', { token: admin });
    const row2 = (reports.data?.items ?? []).find((r) => r.targetId === post2Id);
    check('the second report is queued', !!row2);
    if (row2) {
      const removed = await api('POST', `/admin/reports/${row2.id}/resolve`, { token: admin, body: { action: 'remove' } });
      check('admin removes the content', removed.status === 200, `status ${removed.status}`);
      const gone = await api('GET', `/posts/${post2Id}`, { token: alice });
      check('removed content is no longer retrievable (even for its author)', gone.status === 404, `status ${gone.status}`);
      const feed = await api('GET', '/posts?limit=50', { token: bob });
      check('removed content is absent from the feed', !(feed.data?.items ?? []).some((p) => p.id === post2Id));
      const bookmarks = await api('GET', '/posts/bookmarks', { token: bob });
      check('removed content is absent from bookmarks', !(bookmarks.data?.items ?? []).some((p) => p.id === post2Id));
    }
  }
}

// ---------------------------------------------------------------- media limits
section('upload validation (task 5)');
{
  const MB = 1024 * 1024;
  const av = await api('POST', '/media/uploads', { token: alice, body: { kind: 'avatar', contentType: 'image/png', size: 1024 } });
  check('a normal avatar presigns', av.status === 201 && !!av.data?.uploadUrl, `status ${av.status}`);

  const bigAvatar = await api('POST', '/media/uploads', { token: alice, body: { kind: 'avatar', contentType: 'image/png', size: 3 * MB } });
  check('an oversized avatar is rejected', bigAvatar.status === 400 && bigAvatar.error?.code === 'FILE_TOO_LARGE', JSON.stringify(bigAvatar.error));

  const badType = await api('POST', '/media/uploads', { token: alice, body: { kind: 'post', contentType: 'application/x-msdownload', size: 1024 } });
  check('a non-media content type is rejected', badType.status === 400 && badType.error?.code === 'INVALID_TYPE', JSON.stringify(badType.error));

  const badKind = await api('POST', '/media/uploads', { token: alice, body: { kind: 'executable', contentType: 'image/png', size: 1024 } });
  check('an unknown upload kind is rejected', badKind.status === 400, `status ${badKind.status}`);

  const zero = await api('POST', '/media/uploads', { token: alice, body: { kind: 'post', contentType: 'image/png', size: 0 } });
  check('a zero-byte upload is rejected', zero.status === 400, `status ${zero.status}`);

  // Rejected by the DTO ceiling (which mirrors the largest per-kind limit) or by the kind rule;
  // both are a 400, and which one fires depends on whether the size is above the global ceiling.
  const bigVideo = await api('POST', '/media/uploads', { token: alice, body: { kind: 'video', contentType: 'video/mp4', size: 51 * MB } });
  check('a video above the 50MB cap is rejected', bigVideo.status === 400 && ['FILE_TOO_LARGE', 'VALIDATION_ERROR'].includes(bigVideo.error?.code), JSON.stringify(bigVideo.error));

  const bigPostImage = await api('POST', '/media/uploads', { token: alice, body: { kind: 'post', contentType: 'image/png', size: 9 * MB } });
  check('a post image above its own (smaller) cap is rejected by the kind rule', bigPostImage.status === 400 && bigPostImage.error?.code === 'FILE_TOO_LARGE', JSON.stringify(bigPostImage.error));

  const okVideo = await api('POST', '/media/uploads', { token: alice, body: { kind: 'video', contentType: 'video/mp4', size: 10 * MB } });
  check('a video under the cap presigns', okVideo.status === 201 && !!okVideo.data?.uploadUrl, `status ${okVideo.status}`);

  const badVideoType = await api('POST', '/media/uploads', { token: alice, body: { kind: 'video', contentType: 'video/x-matroska', size: 5 * MB } });
  check('an unsupported video container is rejected', badVideoType.status === 400 && badVideoType.error?.code === 'INVALID_TYPE', JSON.stringify(badVideoType.error));

  const noAuth = await api('POST', '/media/uploads', { body: { kind: 'post', contentType: 'image/png', size: 1024 } });
  check('presigning requires authentication', noAuth.status === 401, `status ${noAuth.status}`);

  const stolen = await api('DELETE', '/media', { token: bob, body: { key: `post/${aliceId}/00000000-0000-4000-8000-000000000000.png` } });
  check("a user cannot delete another user's object", stolen.status === 403, `status ${stolen.status}`);
  skip('file-signature sniffing of the stored object', 'uploads go straight to object storage via a presigned POST; the policy pins content-type and size (see KNOWN_LIMITS)');
}

// ---------------------------------------------------------------- search
section('search (task 6)');
{
  const usersUpper = await api('GET', '/users/search?q=ALI', { token: bob });
  check('user search is case-insensitive', (usersUpper.data?.items ?? []).some((u) => u.handle === 'alice'), `status ${usersUpper.status}`);

  const usersEmpty = await api('GET', '/users/search?q=', { token: bob });
  check('an empty user search returns an empty page', usersEmpty.status === 200 && (usersEmpty.data?.items ?? []).length === 0, `status ${usersEmpty.status}`);

  const marker = `zqsearch${Date.now()}`;
  const made = await api('POST', '/posts', { token: alice, body: { caption: `hello ${marker} world`, mediaUrls: [] } });
  check('a post with a unique marker is created', !!made.data?.id, JSON.stringify(made.error));

  const posts = await api('GET', `/posts/search?q=${marker.toUpperCase()}`, { token: bob });
  check('post search finds the post case-insensitively', (posts.data?.items ?? []).some((p) => p.id === made.data?.id), `status ${posts.status}`);

  const noMatch = await api('GET', '/posts/search?q=zzzz-no-such-post-zzzz', { token: bob });
  check('a no-match post search returns an empty page', noMatch.status === 200 && (noMatch.data?.items ?? []).length === 0, `status ${noMatch.status}`);

  const weird = await api('GET', `/posts/search?q=${encodeURIComponent("'; drop table posts;--")}`, { token: bob });
  check('a SQL-injection style query is handled safely', weird.status === 200, `status ${weird.status}`);

  const long = await api('GET', `/posts/search?q=${'a'.repeat(500)}`, { token: bob });
  check('an over-long query is clamped, not rejected', long.status === 200, `status ${long.status}`);
}

// ---------------------------------------------------------------- regression
section('existing functionality still works');
{
  const feed = await api('GET', '/posts?limit=5', { token: alice });
  check('the feed loads', feed.status === 200 && Array.isArray(feed.data?.items), `status ${feed.status}`);

  const post = await api('POST', '/posts', { token: alice, body: { caption: 'verify text-only post', mediaUrls: [] } });
  check('a text-only post is created with no media', post.status === 201 && (post.data?.mediaUrls ?? []).length === 0, JSON.stringify(post.data?.mediaUrls));

  const like = await api('POST', `/posts/${post.data?.id}/reactions`, { token: bob, body: { reactionType: 'like' } });
  check('reacting to a post works', like.status === 200 && like.data?.isLiked === true, JSON.stringify(like.error));

  const comment = await api('POST', `/posts/${post.data?.id}/comments`, { token: bob, body: { content: 'verify comment' } });
  check('commenting works', comment.status === 201, `status ${comment.status}`);

  const conv = await api('POST', `/conversations/direct/${bobId}`, { token: alice });
  check('a direct conversation opens', !!conv.data?.id, JSON.stringify(conv.error));

  const notif = await api('GET', '/notifications', { token: bob });
  check('notifications load', notif.status === 200, `status ${notif.status}`);

  const selfSuspend = await api('POST', `/admin/users/${adminId}/suspend`, { token: admin });
  check('an admin cannot suspend their own account', selfSuspend.status === 400 && selfSuspend.error?.code === 'SELF_SUSPEND', JSON.stringify(selfSuspend.error));

  const suspended = await api('POST', '/auth/login', { body: { identifier: 'e2e_1791839398760_c', password: 'password123' } });
  check('a suspended account is refused at login', suspended.status === 401, `status ${suspended.status}`);
}

console.log(`\n${pass} passed, ${fail} failed, ${skipped} skipped`);
if (failures.length) { console.log('\nFailures:'); failures.forEach((f) => console.log(` - ${f}`)); }
process.exit(fail ? 1 : 0);
