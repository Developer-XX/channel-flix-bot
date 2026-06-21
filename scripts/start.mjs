#!/usr/bin/env node
// Production start wrapper for self-hosted Node SSR (PM2 / aaPanel).
//
// Why this exists:
//   The Nitro-built server (dist/server/index.mjs) does NOT auto-load a .env
//   file. On Lovable Cloud env vars are injected by the platform; on a VPS we
//   must load them ourselves BEFORE the server boots so that runtime reads of
//   process.env.SUPABASE_URL / TMDB_API_KEY / TELEGRAM_BOT_TOKEN / etc work.
//
// Order:
//   1. Load .env (and .env.production if present) from project root.
//   2. Run preflight validation (fails fast with clear JSON error).
//   3. Dynamically import the built server, which starts listening on $PORT.
//
// Note about VITE_* vars:
//   Anything prefixed VITE_ is BAKED INTO THE CLIENT BUNDLE AT BUILD TIME.
//   Loading them at runtime here is only useful if the SAME bundle is rebuilt
//   on this host. If you change a VITE_* value you MUST re-run `npm run build`.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Load .env files in priority order (later does NOT override earlier).
for (const file of [".env", ".env.production", ".env.local"]) {
  const p = resolve(root, file);
  if (existsSync(p)) {
    dotenv.config({ path: p, override: false });
    console.log(
      JSON.stringify({
        level: "info",
        msg: "loaded env file",
        file,
        ts: new Date().toISOString(),
      }),
    );
  }
}

// Default PORT/HOST if not set.
process.env.PORT = process.env.PORT || "3000";
process.env.HOST = process.env.HOST || "127.0.0.1";
process.env.NODE_ENV = process.env.NODE_ENV || "production";

// Run preflight (synchronous import; exits non-zero on failure).
await import("./preflight.mjs");

// Boot the Nitro server.
const serverPath = resolve(root, "dist/server/index.mjs");
if (!existsSync(serverPath)) {
  console.error(
    JSON.stringify({
      level: "fatal",
      msg: "dist/server/index.mjs not found — run `npm run build` first",
      ts: new Date().toISOString(),
    }),
  );
  process.exit(1);
}

await import(serverPath);
