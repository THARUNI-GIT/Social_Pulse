# Demo walkthrough

A short script that touches every feature. Roughly 10 minutes.

## Accounts

Local demo accounts, created by the seed script. They exist only in your own database and password `password123` is not valid anywhere else.

| Handle | Role |
|---|---|
| `alice`, `bob`, `carol`, `dave`, `emma`, `frank` | normal users |
| `admin` | administrator |

## Reset to a clean state

```sh
bash socialpulse/scripts/reset-demo-data.sh   # backs up, clears posts/chats/notifications
node socialpulse/scripts/seed-demo.mjs        # 6 profiles, 12 posts with images, chats, 1 report
```

`seed-demo.mjs` talks to `http://localhost:8180` by default; set `GATEWAY` to point elsewhere. It generates images locally and uploads them through the same presigned flow the browser uses.

## Script

1. Sign in as `alice`. Feed shows the seeded posts with images, hashtags and counts. Switch between For you and Following.
2. Create a post: caption, `#demo`, attach an image, audience Everyone or Followers only. It appears at the top.
3. Like and comment on a post, bookmark it, then open Bookmarks from the home screen.
4. Open a post to see its own page. Use Share to send it into a chat with a note.
5. Open an incognito window as `bob`, like and comment on alice's post, follow her. Alice's bell updates without a reload.
6. Chat: send direct messages, watch typing, online/last seen, the sent/delivered/read ticks, reactions and image attachments. Open the group "Weekend Crew" to add or remove a member and see the system message.
7. Profile: followers and following lists, follow button, message button, block.
8. Search: People tab, Posts tab, then a trending hashtag from the row above.
9. Report a post as `bob`, then block alice and confirm her content disappears and the direct message is refused.
10. Sign in as `admin`. Reports tab holds the seeded report: remove the post, then restore it from the Removed tab. Users tab allows suspend and unsuspend.
11. Settings: change avatar, display name and bio. The verification bar (if it shows) can be dismissed.
12. Optional: register a new account to see the verification flow, and open Forgot password.

## Skip while demoing

- Google sign-in, unless real Google credentials are set in `.env`.
- Real email delivery, unless SMTP is configured. Without it the service runs in console mode and sends nothing.

## Unverified

Live Google consent and real SMTP delivery were not exercised end to end in this repo's checks; both need credentials from outside the project.
