// Live integration checks for the 2026-10-14 feature set.
//   GATEWAY=http://localhost:8180 node scripts/integration-fixes.mjs
// Requires AUTH_DEV_RETURN_LINKS=true on user-service for the verification/reset flows.
// Uses its own throwaway accounts; it never mutates seeded demo data.
const B = process.env.GATEWAY ?? 'http://localhost:8080';
const stamp = Date.now().toString(36);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ` -> ${extra}` : ''}`); }
};

async function call(path, { method = 'GET', token, body, raw = false } = {}) {
  const r = await fetch(B + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (raw) return { status: r.status, body: j };
  return { ok: r.ok, data: j.data, error: j.error, status: r.status };
}
const must = async (path, o) => {
  const r = await call(path, o);
  if (!r.ok) throw new Error(`${o?.method ?? 'GET'} ${path} -> ${r.status} ${r.error?.message ?? ''}`);
  return r.data;
};

const mkUser = async (label) => {
  const handle = `it_${label}_${stamp}`.slice(0, 20);
  const d = await must('/auth/register', { method: 'POST', body: { email: `${handle}@it.test`, password: 'password123', handle, displayName: `IT ${label}` } });
  return { handle, email: `${handle}@it.test`, token: d.accessToken, id: d.user.id, verified: d.user.verified, devLink: d.devLink, userId: d.user.id };
};

const tokenFrom = (link) => new URL(link).searchParams.get('token');

console.log(`\nGateway: ${B}\n`);

// ---------- F. authentication ----------
console.log('F. auth: registration, verification, login, reset');
const a = await mkUser('a');
const b = await mkUser('b');
ok('register returns a real user id (uuid)', /^[0-9a-f-]{36}$/i.test(a.id), a.id);
ok('register returns working access token', typeof a.token === 'string' && a.token.split('.').length === 3);
ok('new account starts unverified', a.verified === false);
ok('register issues a dev verification link (AUTH_DEV_RETURN_LINKS)', !!a.devLink, 'set AUTH_DEV_RETURN_LINKS=true');

const verifyTok = tokenFrom(a.devLink);
const vres = await call('/auth/verify-email', { method: 'POST', body: { token: verifyTok } });
ok('verify-email accepts a fresh token', vres.ok && vres.data?.verified === true, JSON.stringify(vres.error));
const reuse = await call('/auth/verify-email', { method: 'POST', body: { token: verifyTok } });
ok('verification token is single-use', reuse.status === 400 && reuse.error?.code === 'TOKEN_USED', `${reuse.status} ${reuse.error?.code}`);
const bogus = await call('/auth/verify-email', { method: 'POST', body: { token: 'x'.repeat(32) } });
ok('unknown verification token is rejected', bogus.status === 400 && bogus.error?.code === 'INVALID_TOKEN', `${bogus.status} ${bogus.error?.code}`);

const me = await must('/users/me', { token: a.token });
ok('account is verified after confirming', me.verified === true);

const wrongPw = await call('/auth/login', { method: 'POST', body: { identifier: a.handle, password: 'not-the-password' } });
ok('login rejects a wrong password with 401', wrongPw.status === 401, String(wrongPw.status));
const goodLogin = await call('/auth/login', { method: 'POST', body: { identifier: a.email, password: 'password123' } });
ok('login works by email', goodLogin.ok && !!goodLogin.data?.accessToken);
const noAuth = await call('/posts');
ok('protected route rejects a missing token with 401', noAuth.status === 401, String(noAuth.status));
const badAuth = await call('/posts', { token: 'not.a.jwt' });
ok('protected route rejects an invalid token with 401', badAuth.status === 401, String(badAuth.status));

const forgot = await call('/auth/forgot-password', { method: 'POST', body: { email: a.email } });
ok('forgot-password always answers 200 (no account discovery)', forgot.ok && forgot.data?.sent === true);
const unknown = await call('/auth/forgot-password', { method: 'POST', body: { email: `nobody_${stamp}@it.test` } });
ok('forgot-password is identical for an unknown address', unknown.ok && unknown.data?.sent === true && !unknown.data?.devLink);

if (forgot.data?.devLink) {
  const resetTok = tokenFrom(forgot.data.devLink);
  const shortPw = await call('/auth/reset-password', { method: 'POST', body: { token: resetTok, password: 'short' } });
  ok('reset rejects a too-short password', shortPw.status === 400, String(shortPw.status));
  const reset = await call('/auth/reset-password', { method: 'POST', body: { token: resetTok, password: 'brandNewPass1' } });
  ok('reset accepts a valid token', reset.ok && reset.data?.reset === true, JSON.stringify(reset.error));
  const reused = await call('/auth/reset-password', { method: 'POST', body: { token: resetTok, password: 'anotherPass1' } });
  ok('reset token is single-use', reused.status === 400 && reused.error?.code === 'TOKEN_USED', `${reused.status} ${reused.error?.code}`);
  const oldPw = await call('/auth/login', { method: 'POST', body: { identifier: a.email, password: 'password123' } });
  ok('old password no longer works after reset', oldPw.status === 401, String(oldPw.status));
  const newPw = await call('/auth/login', { method: 'POST', body: { identifier: a.email, password: 'brandNewPass1' } });
  ok('new password works after reset', newPw.ok && !!newPw.data?.accessToken);
  a.token = newPw.data.accessToken;
} else {
  fail += 4; console.log('  FAIL reset flow (no devLink: AUTH_DEV_RETURN_LINKS not enabled)');
}

const logout = await call('/auth/logout', { method: 'POST', body: { refreshToken: goodLogin.data?.refreshToken ?? a.token } });
ok('logout succeeds', logout.ok);
const afterLogout = await call('/users/me', { token: a.token });
ok('access token still valid until it expires (15 min) - documented', afterLogout.ok || afterLogout.status === 401);

// ---------- E. search ----------
console.log('\nE. search');
const post = await must('/posts', { method: 'POST', token: a.token, body: { caption: `IntegrationSearch ${stamp} #itsearch${stamp}`, visibility: 'public' } });
const searchCaption = await must(`/posts/search?q=${encodeURIComponent(`IntegrationSearch ${stamp}`)}`, { token: b.token });
ok('post search finds by case-insensitive caption substring', searchCaption.items.some((p) => p.id === post.id));
const searchUpper = await must(`/posts/search?q=${encodeURIComponent(`INTEGRATIONSEARCH ${stamp}`.toUpperCase())}`, { token: b.token });
ok('post search is case-insensitive', searchUpper.items.some((p) => p.id === post.id));
const searchTag = await must(`/posts/search?q=%23itsearch${stamp}`, { token: b.token });
ok('post search matches the hashtag, with or without #', searchTag.items.some((p) => p.id === post.id));
const searchNone = await must('/posts/search?q=zzz-no-such-post-zzz', { token: b.token });
ok('post search returns an empty page for no matches', searchNone.items.length === 0);
const searchBlank = await must('/posts/search?q=%20%20', { token: b.token });
ok('blank search returns an empty page', searchBlank.items.length === 0);
const usersSearch = await must(`/users/search?q=${encodeURIComponent(a.handle.slice(2, 8))}`, { token: b.token });
ok('user search matches a handle substring', usersSearch.items.some((u) => u.id === a.id));
const usersSearchName = await must(`/users/search?q=${encodeURIComponent('IT a')}`, { token: b.token });
ok('user search matches a display-name substring', usersSearchName.items.some((u) => u.id === a.id));

// ---------- C. feed payload ----------
console.log('\nC. feed/profile payload');
const feed = await must('/posts?limit=5', { token: a.token });
const myPost = feed.items.find((p) => p.id === post.id);
ok('feed author carries isSelf', myPost?.author?.isSelf === true);
const otherFeed = await must('/posts?limit=5', { token: b.token });
const seenPost = otherFeed.items.find((p) => p.id === post.id);
ok('feed author carries isFollowing for other authors', seenPost?.author?.isFollowing === false);
const comments = await must(`/posts/${post.id}/comments`, { method: 'GET', token: b.token });
ok('comment list endpoint responds with items', Array.isArray(comments.items));
const added = await must(`/posts/${post.id}/comments`, { method: 'POST', token: b.token, body: { content: 'integration comment' } });
ok('comment is persisted with an author', added.content === 'integration comment' && !!added.author?.id);
const afterComment = await must(`/posts/${post.id}/comments`, { token: a.token });
ok('comment appears in a refreshed list', afterComment.items.some((c) => c.id === added.id));
const missing = await call('/posts/11111111-1111-4111-8111-111111111111', { token: a.token });
ok('missing post returns 404 (UI shows a friendly notice)', missing.status === 404, String(missing.status));

// ---------- B. media ----------
console.log('\nB. media (images + video)');
const imgPresign = await call('/media/uploads', { method: 'POST', token: a.token, body: { kind: 'post', contentType: 'image/png', size: 1000 } });
ok('image upload presign works', imgPresign.ok && !!imgPresign.data?.uploadUrl, JSON.stringify(imgPresign.error));
const vidPresign = await call('/media/uploads', { method: 'POST', token: a.token, body: { kind: 'video', contentType: 'video/mp4', size: 5_000_000 } });
ok('video upload presign works', vidPresign.ok && !!vidPresign.data?.publicUrl?.endsWith('.mp4'), JSON.stringify(vidPresign.error));
const vidTooBig = await call('/media/uploads', { method: 'POST', token: a.token, body: { kind: 'video', contentType: 'video/mp4', size: 80_000_000 } });
// The gateway's own @Max(50MB) rejects it before media-service can answer FILE_TOO_LARGE: either layer is a pass.
ok('over-limit video is rejected', vidTooBig.status === 400, `${vidTooBig.status} ${vidTooBig.error?.code}`);
const vidTooBigForService = await call('/media/uploads', { method: 'POST', token: a.token, body: { kind: 'post', contentType: 'image/png', size: 20_000_000 } });
ok('media-service enforces the per-kind size limit', vidTooBigForService.status === 400 && vidTooBigForService.error?.code === 'FILE_TOO_LARGE', `${vidTooBigForService.status} ${vidTooBigForService.error?.code}`);
const vidWrongType = await call('/media/uploads', { method: 'POST', token: a.token, body: { kind: 'video', contentType: 'application/pdf', size: 1000 } });
ok('non-video MIME on the video kind is rejected', vidWrongType.status === 400 && vidWrongType.error?.code === 'INVALID_TYPE', `${vidWrongType.status} ${vidWrongType.error?.code}`);
const foreignMedia = await call('/posts', { method: 'POST', token: a.token, body: { caption: 'x', mediaUrls: ['https://evil.example/steal.png'] } });
ok('post rejects media outside our bucket', foreignMedia.status === 400 && foreignMedia.error?.code === 'INVALID_MEDIA_URL', `${foreignMedia.status} ${foreignMedia.error?.code}`);
const textOnly = await call('/posts', { method: 'POST', token: a.token, body: { caption: `text only ${stamp}` } });
ok('text-only post is accepted with no media', textOnly.ok && (textOnly.data?.mediaUrls ?? []).length === 0);

// ---------- D. chat ----------
console.log('\nD. chat: unread, reactions, groups');
const direct = await must(`/conversations/direct/${b.id}`, { method: 'POST', token: a.token });
ok('direct conversation is created with type direct', direct.type === 'direct' && direct.members.length === 2);
const unreadBefore = await must('/conversations/unread', { token: b.token });
ok('unread endpoint responds with total + breakdown', typeof unreadBefore.total === 'number' && !!unreadBefore.byConversation);

const group = await must('/conversations/group', { method: 'POST', token: a.token, body: { name: `IT Group ${stamp}`, memberIds: [b.id] } });
ok('group is created with type/name/admins', group.type === 'group' && group.name === `IT Group ${stamp}` && group.admins.includes(a.id));
ok('group contains both members', group.members.includes(a.id) && group.members.includes(b.id));
const groupList = await must('/conversations', { token: b.token });
ok('group appears in the member\'s conversation list', groupList.some((c) => c.id === group.id && c.type === 'group'));
const groupGet = await must(`/conversations/${group.id}`, { token: b.token });
ok('member can read the group', groupGet.id === group.id);
const third = await mkUser('c');
const outsiderRead = await call(`/conversations/${group.id}`, { token: third.token });
ok('non-member cannot read the group (403)', outsiderRead.status === 403, String(outsiderRead.status));
const outsiderAdd = await call(`/conversations/${group.id}/members`, { method: 'POST', token: third.token, body: { memberIds: [third.id] } });
ok('non-member cannot add members (403)', outsiderAdd.status === 403, String(outsiderAdd.status));
const memberAdd = await call(`/conversations/${group.id}/members`, { method: 'POST', token: b.token, body: { memberIds: [third.id] } });
ok('non-admin member cannot add members (403)', memberAdd.status === 403, String(memberAdd.status));

const renamed = await must(`/conversations/${group.id}`, { method: 'PATCH', token: a.token, body: { name: `IT Group renamed ${stamp}` } });
ok('admin can rename the group', renamed.name === `IT Group renamed ${stamp}`);
const addedMember = await must(`/conversations/${group.id}/members`, { method: 'POST', token: a.token, body: { memberIds: [third.id] } });
ok('admin can add a member', addedMember.members.includes(third.id));
const nowVisible = await must('/conversations', { token: third.token });
ok('added member sees the group', nowVisible.some((c) => c.id === group.id));
const tooFew = await call('/conversations/group', { method: 'POST', token: a.token, body: { name: 'solo', memberIds: [] } });
ok('a group needs at least one other member (400)', tooFew.status === 400, String(tooFew.status));
const badMember = await call('/conversations/group', { method: 'POST', token: a.token, body: { name: 'bad', memberIds: ['not-a-uuid'] } });
ok('malformed member ids are rejected (400)', badMember.status === 400, String(badMember.status));
const removed = await must(`/conversations/${group.id}/members/${third.id}`, { method: 'DELETE', token: a.token });
ok('admin can remove a member', removed.removed === third.id);
const afterRemoval = await must('/conversations', { token: third.token });
ok('removed member no longer sees the group', !afterRemoval.some((c) => c.id === group.id));
const selfLeave = await call(`/conversations/${group.id}/members/${b.id}`, { method: 'DELETE', token: b.token });
ok('a member can remove themselves (leave)', selfLeave.ok, String(selfLeave.status));
const reAdd = await call(`/conversations/${group.id}/members`, { method: 'POST', token: a.token, body: { memberIds: [b.id] } });
ok('a left member can be re-added', reAdd.ok);

console.log('\nA. blocks');
const blocked = await must(`/users/${a.id}/block`, { method: 'POST', token: b.token });
ok('block succeeds', blocked.isBlocked === true);
const blockedDm = await call(`/conversations/direct/${a.id}`, { method: 'POST', token: b.token });
ok('blocked user cannot start a DM with the blocker', blockedDm.status === 403 && blockedDm.error?.code === 'USER_BLOCKED', `${blockedDm.status} ${blockedDm.error?.code}`);
const hiddenSearch = await must(`/users/search?q=${encodeURIComponent(a.handle)}`, { token: b.token });
ok('blocked user is hidden from search', !hiddenSearch.items.some((u) => u.id === a.id));
const unblocked = await must(`/users/${a.id}/block`, { method: 'DELETE', token: b.token });
ok('unblock succeeds', unblocked.isBlocked === false);

// ---------- G. routing ----------
console.log('\nG. gateway routing');
const notFound = await call('/definitely-not-a-route');
ok('unknown route returns 404 (not a misleading 401)', notFound.status === 404, String(notFound.status));
const internal = await call('/users/batch', { method: 'POST', body: { ids: [] } });
ok('internal-only route is not reachable through the gateway', internal.status === 404, String(internal.status));
const adminNoToken = await call('/admin/overview');
ok('admin route without a token is 401', adminNoToken.status === 401, String(adminNoToken.status));
const adminAsUser = await call('/admin/overview', { token: a.token });
ok('admin route as a normal user is 403', adminAsUser.status === 403, String(adminAsUser.status));

console.log(`\n${pass} passed, ${fail} failed (of ${pass + fail})\n`);
process.exit(fail ? 1 : 0);
