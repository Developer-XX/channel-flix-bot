#!/usr/bin/env node
// External MTProto backfill for Telegram channel history.
// See README.md for setup. Do NOT try to run this inside the Lovable
// backend — gramjs needs raw TCP / persistent connections that workerd
// does not provide.

import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';

const {
  TELEGRAM_API_ID,
  TELEGRAM_API_HASH,
  BACKFILL_SECRET,
  APP_URL,
  STRING_SESSION = '',
} = process.env;

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const v = process.argv[idx + 1];
  return v && !v.startsWith('--') ? v : true;
}

function need(name, value) {
  if (!value) {
    console.error(`Missing ${name} (set in .env)`);
    process.exit(1);
  }
}

need('TELEGRAM_API_ID', TELEGRAM_API_ID);
need('TELEGRAM_API_HASH', TELEGRAM_API_HASH);
need('BACKFILL_SECRET', BACKFILL_SECRET);
need('APP_URL', APP_URL);

const session = new StringSession(STRING_SESSION || '');
const client = new TelegramClient(session, Number(TELEGRAM_API_ID), TELEGRAM_API_HASH, {
  connectionRetries: 5,
});

async function login() {
  await client.start({
    phoneNumber: async () => input.text('Phone number (with country code, e.g. +15551234567): '),
    password: async () => input.text('2FA password (leave blank if disabled): '),
    phoneCode: async () => input.text('SMS code: '),
    onError: (err) => console.error(err),
  });
  console.log('\n=== Save this in .env as STRING_SESSION ===');
  console.log(client.session.save());
  console.log('===========================================\n');
  await client.disconnect();
}

function sign(body) {
  return createHmac('sha256', BACKFILL_SECRET).update(body).digest('hex');
}

async function postIngest(payload) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${APP_URL}/api/public/telegram/backfill-ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-backfill-signature': sign(body) },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`ingest HTTP ${res.status} ${txt}`);
  }
  return res.json();
}

// Map an MTProto Message to a synthetic Bot-API-shaped update so the
// existing ingest pipeline (parser/matcher) processes it unchanged.
function toBotApiUpdate(msg, channelId) {
  const base = {
    message_id: msg.id,
    chat: { id: channelId, type: 'channel' },
    caption: msg.message || null,
    date: Math.floor((msg.date || Date.now() / 1000)),
  };
  const m = msg.media;
  // gramjs media → Bot API shape (approximate; what the parser actually needs)
  if (m?.document) {
    const d = m.document;
    const attrFile = (d.attributes || []).find((a) => a.fileName);
    const attrVideo = (d.attributes || []).find((a) => a.duration !== undefined);
    const mime = d.mimeType || '';
    const fileBlock = {
      file_id: String(d.id ?? ''),
      file_unique_id: String(d.accessHash ?? d.id ?? ''),
      file_name: attrFile?.fileName ?? null,
      mime_type: mime,
      file_size: Number(d.size ?? 0),
      duration: attrVideo?.duration,
    };
    if (mime.startsWith('video/')) base.video = fileBlock;
    else if (mime.startsWith('audio/')) base.audio = fileBlock;
    else base.document = fileBlock;
  } else if (m?.photo) {
    const p = m.photo;
    base.photo = [{
      file_id: String(p.id ?? ''),
      file_unique_id: String(p.accessHash ?? p.id ?? ''),
      file_size: 0,
    }];
  } else {
    return null; // no file — skip
  }
  // Synthetic update_id: combine channel + message id so retries dedupe.
  const update_id = Math.abs(Number(channelId) % 1_000_000_000) * 100_000 + (msg.id % 100_000);
  return { update_id, channel_post: base };
}

async function runBackfill() {
  const channelArg = arg('--channel');
  if (!channelArg || channelArg === true) {
    console.error('Usage: node backfill.mjs --channel <chat_id_or_@username> [--limit N] [--resume]');
    process.exit(1);
  }
  const limit = Number(arg('--limit', 0)) || Infinity;
  const resume = arg('--resume', false) === true;

  await client.connect();
  if (!(await client.checkAuthorization())) {
    console.error('Not logged in. Run: node backfill.mjs --login');
    process.exit(1);
  }

  const entity = await client.getEntity(channelArg);
  const channelId = Number(entity.id?.toString?.() ?? entity.id);
  // Telegram chat ids for channels are stored as -100<id> in Bot API land.
  const botApiChannelId = entity.broadcast || entity.megagroup
    ? Number(`-100${channelId}`)
    : channelId;
  console.log(`Backfilling channel ${entity.title || channelArg} (botApiChannelId=${botApiChannelId}) limit=${limit === Infinity ? 'all' : limit} resume=${resume}`);

  let cursor = resume ? 0 : 0; // could read prior cursor from DB via app endpoint if needed
  let ingested = 0;
  let failed = 0;
  let oldest = 0;
  const BATCH = 100;

  await postIngest({ kind: 'progress', channelId: botApiChannelId, cursor, ingested, status: 'running' });

  try {
    for await (const msg of client.iterMessages(entity, { limit: limit === Infinity ? undefined : limit, reverse: true })) {
      const update = toBotApiUpdate(msg, botApiChannelId);
      if (!update) continue;
      try {
        const r = await postIngest({ kind: 'message', update });
        if (r?.ok !== false) ingested++;
        else failed++;
      } catch (e) {
        failed++;
        console.warn(`msg ${msg.id} failed: ${e.message}`);
      }
      oldest = msg.id;
      if (ingested % 25 === 0) {
        cursor = msg.id;
        await postIngest({ kind: 'progress', channelId: botApiChannelId, cursor, ingested, status: 'running' });
        console.log(`  ... ${ingested} ingested (${failed} failed), cursor=${cursor}`);
      }
      await new Promise((r) => setTimeout(r, 30)); // gentle pacing
    }
    await postIngest({ kind: 'progress', channelId: botApiChannelId, cursor: oldest, ingested, status: 'done' });
    console.log(`\nDone. Ingested ${ingested}, failed ${failed}.`);
  } catch (e) {
    await postIngest({ kind: 'progress', channelId: botApiChannelId, cursor: oldest, ingested, status: `failed: ${String(e.message).slice(0, 80)}` });
    throw e;
  } finally {
    await client.disconnect();
  }
}

const mode = process.argv.includes('--login') ? 'login' : 'backfill';
(mode === 'login' ? login() : runBackfill()).catch((e) => {
  console.error(e);
  process.exit(1);
});
