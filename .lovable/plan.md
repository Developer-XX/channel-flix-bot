## 1. Fix the admin panel "redirects to home" bug

The current `admin.tsx` `beforeLoad` silently does `throw redirect({ to: "/" })` whenever `getAdminGate()` returns `canAccessAdmin: false` OR when the server function throws (no `errorComponent`). Either case looks identical to the user: bounced to home.

Fixes:
- Add `errorComponent` and `notFoundComponent` to the admin route so server errors are visible instead of swallowed.
- Replace the blind redirect with a small "Access denied" screen showing: signed-in email, current roles, and (if no admin exists yet) a "Claim first admin" button — so you can see exactly why access was denied.
- Diagnostic line: render which user id the gate evaluated, useful when sessions go stale.

## 2. Telegram bot — command handler in DMs

Extend `src/routes/api/public/telegram/webhook.ts`. When the incoming update is a `message` (not a `channel_post`) in a private chat, dispatch:

- `/start` and `/help` — reply with setup instructions (how to add the bot as channel admin, what captions to use, link to admin panel).
- `/status` — reply with bot username, channel count, recent ingest count.
- `/channels` — list configured channels and admin status.
- `/broadcast <text>` — admin-only (sender's Telegram id must be in a new `telegram_admin_ids` setting); sends a message to every configured channel.
- `/id` — reply with the chat id so you can copy channel/user ids easily.

All replies go through the existing `sendTelegramMessage` helper. Unknown commands get a short "Type /help" reply.

## 3. Visual confirmation after ingest

Inside `ingestTelegramPost` (in `telegram-ingest.server.ts`), after a successful insert into `telegram_ingest`, call `setMessageReaction` on the source message with a 👀 emoji (or 👍 if it was promoted). The reaction acts as a passive "bot saw this" indicator visible in the channel. Failure to react is logged but not fatal.

Also add an opt-in setting `confirm_with_reply` per channel: when true, the bot posts a tiny reply (`✅ Ingested · S01E02 · 1080p`) instead of just a reaction.

## 4. Channel connection wizard

New section at the top of `/admin/telegram` (Channel Wizard) — a 3-step inline flow:

1. **Add channel** — paste a `@username` or numeric id. The wizard calls a new `verifyTelegramChannel` server fn which:
   - Calls `getChat` to resolve the channel.
   - Calls `getChatMember` for the bot id to confirm `status === 'administrator'` and that `can_post_messages` / `can_read_messages` are granted.
   - Returns `{ ok, title, type, isAdmin, canRead, missing }`.
2. **Save** — if `ok && isAdmin`, insert/update `telegram_channels` row.
3. **Test post** — instructs you to post a sample caption, then a "Check now" button refreshes `telegram_ingest` filtered to that channel and shows the result inline.

A simple list of existing channels with a "Re-verify" button per row is rendered below the wizard.

## 5. Files to touch

```text
src/routes/_authenticated/admin.tsx               (error UI, no silent redirect)
src/routes/_authenticated/admin.telegram.tsx     (Channel Wizard UI)
src/routes/api/public/telegram/webhook.ts        (command dispatch)
src/lib/telegram.functions.ts                    (verifyTelegramChannel, saveChannel, listChannels)
src/lib/telegram-ingest.server.ts                (reaction/reply confirmation)
src/lib/telegram-api.server.ts                   (NEW — sendMessage / setMessageReaction / getChat / getChatMember helpers, if not already centralized)
```

No DB migration needed unless you want a `confirm_with_reply` flag + `telegram_admin_ids` setting — those go into a small migration adding two columns to `telegram_channels` and a row in `telegram_bot_state` (or a new `telegram_settings` table).

## 6. Order of work

1. Ship the admin-route fix first so you can actually reach `/admin/telegram` and see diagnostics.
2. Migration for the new flags.
3. Bot command handler + reaction confirmation (lets you immediately verify in Telegram).
4. Channel wizard UI.

After step 1 you should retry `/admin` — if it still bounces, the new diagnostic screen will tell us exactly why (wrong user id, missing role, server error), and we adjust from there.
