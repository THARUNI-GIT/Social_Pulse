#!/usr/bin/env node
/**
 * SocialPulse — demo-account cleanup PLANNER (dry run).
 *
 * READ-ONLY. This script never deletes anything. It inventories every account, counts the rows
 * that reference it across all four datastores, classifies each account, and writes a proposal to
 * docs/CLEANUP-PLAN.md. An operator must review it and explicitly approve before any deletion.
 *
 *   node scripts/cleanup-plan.mjs
 *
 * Classification is pattern-based and deliberately conservative: anything that does not match a
 * known throwaway pattern is reported as KEEP/REVIEW so real user data is never proposed for
 * removal by accident.
 */
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';

const sh = (cmd) => {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch (e) { return (e.stdout ?? '').trim(); }
};
const psql = (db, sql) => sh(`docker compose exec -T postgres psql -U postgres -d ${db} -tAc "${sql}"`)
  .split('\n').map((l) => l.replace(/\r$/, ''));
const mongoJson = (js) => {
  const out = sh(`docker compose exec -T mongodb mongosh --quiet --eval "${js}"`).replace(/\r/g, '');
  try { return JSON.parse(out); } catch { return null; }
};

/** Accounts the product exposes on the sign-in screen and the platform administrator. */
const PROTECTED_HANDLES = ['admin', 'alice', 'bob', 'carol'];
/** Recognisable throwaway shapes created by the automated test suites. */
const THROWAWAY = [
  /^e2e_\d+_[abc]$/,
  /^it_[abc]_[a-z0-9]+$/,
  /^bk_[xy]_[a-z0-9]+$/,
  /^probe/i,
  /^verify_/,
];

console.log('SocialPulse demo-account cleanup planner (dry run - nothing is deleted)\n');

const users = psql('user_db',
  "select id || '|' || handle || '|' || email || '|' || array_to_string(roles,',') || '|' || (suspended_at is not null) || '|' || created_at from users order by created_at"
).filter(Boolean).map((row) => {
  const [id, handle, email, roles, suspended, createdAt] = row.split('|');
  return { id, handle, email, roles, suspended: suspended === 't', createdAt };
});
console.log(`accounts: ${users.length}`);

// ---- dependent counts (postgres: user_db) -------------------------------------------------
const followRows = psql('user_db', "select follower_id || '|' || following_id from follows").filter(Boolean);
const blockRows = psql('user_db', "select blocker_id || '|' || blocked_id from blocks").filter(Boolean);
const tokenCounts = new Map();
for (const r of psql('user_db', "select user_id || '|' || count(*) from refresh_tokens group by user_id").filter(Boolean)) {
  const [uid, n] = r.split('|'); tokenCounts.set(uid, +n);
}
const authTokenCounts = new Map();
for (const r of psql('user_db', "select user_id || '|' || count(*) from auth_tokens group by user_id").filter(Boolean)) {
  const [uid, n] = r.split('|'); authTokenCounts.set(uid, +n);
}

// ---- dependent counts (postgres: content_db) ---------------------------------------------
const contentOwner = {
  posts: new Map(), comments: new Map(), reactions: new Map(),
  bookmarks: new Map(), shares: new Map(), reportsBy: new Map(), reportsAgainst: new Map(),
};
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
for (const [key, sql] of Object.entries({
  posts: 'select author_id from posts',
  comments: 'select author_id from comments',
  reactions: 'select user_id from reactions',
  bookmarks: 'select user_id from bookmarks',
  shares: 'select user_id from shares',
})) {
  for (const r of psql('content_db', sql).filter(Boolean)) bump(contentOwner[key], r);
}
for (const r of psql('content_db', "select reporter_id || '|' || target_id || '|' || target_type from reports").filter(Boolean)) {
  const [reporter, target, type] = r.split('|');
  bump(contentOwner.reportsBy, reporter);
  if (type === 'post') bump(contentOwner.reportsAgainst, target);
}

// ---- dependent counts (mongo: chat_db) ----------------------------------------------------
const chatMembers = new Map();
const chatMessages = new Map();
const chatAgg = mongoJson(`JSON.stringify(db.getSiblingDB('chat_db').conversations.aggregate([{$unwind:'$members'},{$group:{_id:'$members',c:{$sum:1}}}]).toArray())`);
for (const r of chatAgg ?? []) chatMembers.set(r._id, r.c);
const msgAgg = mongoJson(`JSON.stringify(db.getSiblingDB('chat_db').messages.aggregate([{$group:{_id:'$senderId',c:{$sum:1}}}]).toArray())`);
for (const r of msgAgg ?? []) chatMessages.set(r._id, r.c);

// ---- dependent counts (mongo: notification_db) --------------------------------------------
const notifCounts = new Map();
const notifAgg = mongoJson(`JSON.stringify(db.getSiblingDB('notification_db').notifications.aggregate([{$group:{_id:'$recipientId',c:{$sum:1}}}]).toArray())`);
for (const r of notifAgg ?? []) notifCounts.set(r._id, r.c);

const ownedPostIds = new Set(psql('content_db', 'select id from posts').filter(Boolean));
const reportTargetsAgainst = new Set(psql('content_db', "select target_id from reports where target_type='post'").filter(Boolean));

// ---- classify ------------------------------------------------------------------------------
function classify(u) {
  if (u.roles.includes('admin')) return 'KEEP (administrator)';
  if (PROTECTED_HANDLES.includes(u.handle)) return 'KEEP (documented demo account)';
  if (THROWAWAY.some((re) => re.test(u.handle))) return 'CANDIDATE (test-generated)';
  if (/@(example\.com|it\.test|test\.local)$/i.test(u.email)) return 'REVIEW (test-looking email, human decision required)';
  return 'KEEP (appears to be real user data)';
}

const rows = users.map((u) => {
  const counts = {
    posts: contentOwner.posts.get(u.id) ?? 0,
    comments: contentOwner.comments.get(u.id) ?? 0,
    reactions: contentOwner.reactions.get(u.id) ?? 0,
    bookmarks: contentOwner.bookmarks.get(u.id) ?? 0,
    shares: contentOwner.shares.get(u.id) ?? 0,
    reportsFiled: contentOwner.reportsBy.get(u.id) ?? 0,
    follows: followRows.filter((r) => r.includes(u.id)).length,
    blocks: blockRows.filter((r) => r.includes(u.id)).length,
    refreshTokens: tokenCounts.get(u.id) ?? 0,
    authTokens: authTokenCounts.get(u.id) ?? 0,
    conversations: chatMembers.get(u.id) ?? 0,
    messagesSent: chatMessages.get(u.id) ?? 0,
    notifications: notifCounts.get(u.id) ?? 0,
  };
  const dependents = Object.values(counts).reduce((a, b) => a + b, 0);
  return { ...u, counts, dependents, verdict: classify(u) };
});

const candidates = rows.filter((r) => r.verdict.startsWith('CANDIDATE'));
const review = rows.filter((r) => r.verdict.startsWith('REVIEW'));
const keep = rows.filter((r) => r.verdict.startsWith('KEEP'));

const sum = (list, key) => list.reduce((a, r) => a + r.counts[key], 0);
const totalDependents = candidates.reduce((a, r) => a + r.dependents, 0);

// ---- report --------------------------------------------------------------------------------
const stamp = new Date().toISOString();
const table = (list) => [
  '| handle | email | role | suspended | posts | comments | convs | msgs | follows | blocks | notifications | verdict |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...list.map((r) => `| ${r.handle} | ${r.email} | ${r.roles} | ${r.suspended ? 'yes' : 'no'} | ${r.counts.posts} | ${r.counts.comments} | ${r.counts.conversations} | ${r.counts.messagesSent} | ${r.counts.follows} | ${r.counts.blocks} | ${r.counts.notifications} | ${r.verdict} |`),
].join('\n');

const md = `# SocialPulse — demo-account cleanup plan (DRY RUN)

Generated: ${stamp}

> **NOTHING HAS BEEN DELETED.** This is a read-only inventory produced by
> \`scripts/cleanup-plan.mjs\`. Deletion requires explicit human approval of this document.

## Summary

| Group | Accounts | Dependent rows |
|---|---|---|
| KEEP | ${keep.length} | — |
| CANDIDATE for removal | ${candidates.length} | ${totalDependents} |
| REVIEW (needs your decision) | ${review.length} | ${review.reduce((a, r) => a + r.dependents, 0)} |
| **Total accounts** | **${rows.length}** | |

### Keep
${table(keep)}

### Candidate for removal (test-generated)
${candidates.length ? table(candidates) : '_none_'}

Aggregate impact if every candidate were removed:
${['posts', 'comments', 'reactions', 'bookmarks', 'shares', 'reportsFiled', 'follows', 'blocks', 'refreshTokens', 'authTokens', 'conversations', 'messagesSent', 'notifications']
  .map((k) => `- ${k}: ${sum(candidates, k)}`).join('\n')}

### Needs your decision
${review.length ? table(review) : '_none_'}

## Foreign keys and cascade behaviour (verified from the migrations)

- \`user_db.refresh_tokens\`, \`user_db.auth_tokens\`, \`user_db.follows\`, \`user_db.blocks\` all
  reference \`users.id\` with \`onDelete: Cascade\` — deleting a user removes them automatically.
- \`content_db\` has **no** foreign key to \`user_db\` (separate databases). Posts, comments,
  reactions, bookmarks, shares and reports are keyed by a plain \`author_id\` **uuid** with no
  constraint. Deleting a user therefore leaves these rows orphaned unless they are deleted
  explicitly, in the same transaction.
- \`chat_db\` and \`notification_db\` are MongoDB: no cross-database constraints. Member ids sit
  inside the \`conversations.members\` array, so a deleted account would linger as a phantom member.
- Uploaded media lives in object storage under \`{kind}/{userId}/{uuid}.{ext}\`. The
  \`{userId}\` folder is reachable only by that user, so its objects must be listed and removed
  separately.

## Recommended procedure (only after approval)

1. Verify the backup created by \`scripts/backup-databases.sh\` restores cleanly.
2. In \`content_db\`, delete dependent rows for the approved ids first (posts -> comments ->
   reactions/bookmarks/shares -> reports), then the users.
3. In \`user_db\`, delete the users — cascades handle tokens/follows/blocks.
4. In \`chat_db\`, \`$pull\` the ids from \`conversations.members\`/\`admins\`, then reassign or
   delete conversations left empty. Delete their messages.
5. In \`notification_db\`, delete notifications where the recipient or actor is removed.
6. Remove object-storage prefixes for the removed ids.
7. Re-run \`node scripts/cleanup-plan.mjs\` and confirm the surviving set, then sign in as the
   administrator to confirm access is intact.
`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/CLEANUP-PLAN.md', md);

console.log(`\nKEEP:      ${keep.length}`);
console.log(`CANDIDATE: ${candidates.length} (${totalDependents} dependent rows)`);
console.log(`REVIEW:    ${review.length}`);
console.log('\nCandidates:');
candidates.forEach((r) => console.log(`  - ${r.handle} <${r.email}> deps=${r.dependents}`));
if (review.length) { console.log('\nNeeds your decision:'); review.forEach((r) => console.log(`  - ${r.handle} <${r.email}> deps=${r.dependents}`)); }
console.log('\nWritten to docs/CLEANUP-PLAN.md - NOTHING was deleted.');
