// Build identifier injected by Vite's `define` (see vite.config.ts).
// Used by /api/public/health and the client BuildSync provider to detect
// when the running client bundle is older than the deployed server.
declare const __BUILD_ID__: string;

export const BUILD_ID: string =
  typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev-unknown";
