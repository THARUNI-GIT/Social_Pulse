# SocialPulse — demo-account cleanup plan (DRY RUN)

Generated: 2026-10-14T18:54:23.785Z

> **NOTHING HAS BEEN DELETED.** This is a read-only inventory produced by
> `scripts/cleanup-plan.mjs`. Deletion requires explicit human approval of this document.

## Summary

| Group | Accounts | Dependent rows |
|---|---|---|
| KEEP | 7 | — |
| CANDIDATE for removal | 32 | 214 |
| REVIEW (needs your decision) | 0 | 0 |
| **Total accounts** | **39** | |

### Keep
| handle | email | role | suspended | posts | comments | convs | msgs | follows | blocks | notifications | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| admin | admin@demo.io | user,admin | no | 1 | 0 | 6 | 5 | 0 | 1 | 7 | KEEP (administrator) |
| alice | alice@demo.io | user | no | 12 | 3 | 7 | 11 | 3 | 1 | 15 | KEEP (documented demo account) |
| bob | bob@demo.io | user | no | 2 | 2 | 6 | 8 | 2 | 0 | 6 | KEEP (documented demo account) |
| carol | carol@demo.io | user | no | 2 | 1 | 2 | 1 | 0 | 2 | 6 | KEEP (documented demo account) |
| tharus | tharunisri.balukuri@gmail.com | user | no | 0 | 1 | 1 | 1 | 0 | 0 | 2 | KEEP (appears to be real user data) |
| thara | 2025tharuni@gmail.com | user | no | 1 | 1 | 3 | 7 | 1 | 0 | 3 | KEEP (appears to be real user data) |
| wonderwomaniyaa | tharuni.23mic7268@vitapstudent.ac.in | user | no | 0 | 0 | 3 | 9 | 0 | 2 | 2 | KEEP (appears to be real user data) |

### Candidate for removal (test-generated)
| handle | email | role | suspended | posts | comments | convs | msgs | follows | blocks | notifications | verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| e2e_1791836156597_a | e2e_1791836156597_a@example.com | user | no | 3 | 0 | 1 | 1 | 1 | 0 | 3 | CANDIDATE (test-generated) |
| e2e_1791836156597_b | e2e_1791836156597_b@example.com | user | no | 0 | 1 | 1 | 0 | 1 | 0 | 1 | CANDIDATE (test-generated) |
| e2e_1791836156597_c | e2e_1791836156597_c@example.com | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| e2e_1791839398760_a | e2e_1791839398760_a@example.com | user | no | 3 | 0 | 1 | 1 | 1 | 0 | 3 | CANDIDATE (test-generated) |
| e2e_1791839398760_b | e2e_1791839398760_b@example.com | user | no | 0 | 1 | 1 | 0 | 1 | 0 | 1 | CANDIDATE (test-generated) |
| e2e_1791839398760_c | e2e_1791839398760_c@example.com | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| it_a_mv84whtf | it_a_mv84whtf@it.test | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| it_b_mv84whtf | it_b_mv84whtf@it.test | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| it_a_mv84xze9 | it_a_mv84xze9@it.test | user | no | 2 | 0 | 2 | 0 | 0 | 0 | 1 | CANDIDATE (test-generated) |
| it_b_mv84xze9 | it_b_mv84xze9@it.test | user | no | 0 | 1 | 2 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| it_c_mv84xze9 | it_c_mv84xze9@it.test | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| bk_x_mv851ati | bk_x_mv851ati@it.test | user | no | 0 | 0 | 1 | 0 | 0 | 1 | 0 | CANDIDATE (test-generated) |
| bk_y_mv851ati | bk_y_mv851ati@it.test | user | no | 0 | 0 | 1 | 0 | 0 | 1 | 0 | CANDIDATE (test-generated) |
| it_a_mv85d942 | it_a_mv85d942@it.test | user | no | 2 | 0 | 2 | 0 | 0 | 1 | 1 | CANDIDATE (test-generated) |
| it_b_mv85d942 | it_b_mv85d942@it.test | user | no | 0 | 1 | 2 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| it_c_mv85d942 | it_c_mv85d942@it.test | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| e2e_1791984647857_a | e2e_1791984647857_a@example.com | user | no | 3 | 0 | 1 | 1 | 1 | 0 | 3 | CANDIDATE (test-generated) |
| e2e_1791984647857_b | e2e_1791984647857_b@example.com | user | no | 0 | 1 | 1 | 0 | 1 | 0 | 1 | CANDIDATE (test-generated) |
| e2e_1791984647857_c | e2e_1791984647857_c@example.com | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| it_a_mv86ar32 | it_a_mv86ar32@it.test | user | no | 2 | 0 | 2 | 0 | 0 | 1 | 1 | CANDIDATE (test-generated) |
| it_b_mv86ar32 | it_b_mv86ar32@it.test | user | no | 0 | 1 | 2 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| it_c_mv86ar32 | it_c_mv86ar32@it.test | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| e2e_1791986177123_a | e2e_1791986177123_a@example.com | user | no | 3 | 0 | 1 | 1 | 1 | 0 | 3 | CANDIDATE (test-generated) |
| e2e_1791986177123_b | e2e_1791986177123_b@example.com | user | no | 0 | 1 | 1 | 0 | 1 | 0 | 1 | CANDIDATE (test-generated) |
| e2e_1791986177123_c | e2e_1791986177123_c@example.com | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| e2e_1791993669576_a | e2e_1791993669576_a@example.com | user | no | 3 | 0 | 1 | 1 | 1 | 0 | 3 | CANDIDATE (test-generated) |
| e2e_1791993669576_b | e2e_1791993669576_b@example.com | user | no | 0 | 1 | 1 | 0 | 1 | 0 | 1 | CANDIDATE (test-generated) |
| e2e_1791993669576_c | e2e_1791993669576_c@example.com | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| e2e_1792000661878_a | e2e_1792000661878_a@example.com | user | no | 3 | 0 | 1 | 1 | 1 | 0 | 3 | CANDIDATE (test-generated) |
| e2e_1792000661878_b | e2e_1792000661878_b@example.com | user | no | 0 | 1 | 1 | 0 | 1 | 0 | 1 | CANDIDATE (test-generated) |
| e2e_1792000661878_c | e2e_1792000661878_c@example.com | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |
| e2e_1792000690088_a | e2e_1792000690088_a@example.com | user | no | 0 | 0 | 0 | 0 | 0 | 0 | 0 | CANDIDATE (test-generated) |

Aggregate impact if every candidate were removed:
- posts: 24
- comments: 9
- reactions: 6
- bookmarks: 6
- shares: 0
- reportsFiled: 6
- follows: 12
- blocks: 4
- refreshTokens: 58
- authTokens: 30
- conversations: 26
- messagesSent: 6
- notifications: 27

### Needs your decision
_none_

## Foreign keys and cascade behaviour (verified from the migrations)

- `user_db.refresh_tokens`, `user_db.auth_tokens`, `user_db.follows`, `user_db.blocks` all
  reference `users.id` with `onDelete: Cascade` — deleting a user removes them automatically.
- `content_db` has **no** foreign key to `user_db` (separate databases). Posts, comments,
  reactions, bookmarks, shares and reports are keyed by a plain `author_id` **uuid** with no
  constraint. Deleting a user therefore leaves these rows orphaned unless they are deleted
  explicitly, in the same transaction.
- `chat_db` and `notification_db` are MongoDB: no cross-database constraints. Member ids sit
  inside the `conversations.members` array, so a deleted account would linger as a phantom member.
- Uploaded media lives in object storage under `{kind}/{userId}/{uuid}.{ext}`. The
  `{userId}` folder is reachable only by that user, so its objects must be listed and removed
  separately.

## Recommended procedure (only after approval)

1. Verify the backup created by `scripts/backup-databases.sh` restores cleanly.
2. In `content_db`, delete dependent rows for the approved ids first (posts -> comments ->
   reactions/bookmarks/shares -> reports), then the users.
3. In `user_db`, delete the users — cascades handle tokens/follows/blocks.
4. In `chat_db`, `$pull` the ids from `conversations.members`/`admins`, then reassign or
   delete conversations left empty. Delete their messages.
5. In `notification_db`, delete notifications where the recipient or actor is removed.
6. Remove object-storage prefixes for the removed ids.
7. Re-run `node scripts/cleanup-plan.mjs` and confirm the surviving set, then sign in as the
   administrator to confirm access is intact.
