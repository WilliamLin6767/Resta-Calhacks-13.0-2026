// The server's connection to Convex, the live-update layer (server only: it holds the secret).
// Convex is off unless both NEXT_PUBLIC_CONVEX_URL and LIVE_SYNC_SECRET are set; then nothing
// is signalled and the app works exactly as without it.
import "server-only";
import { ConvexHttpClient } from "convex/browser";

export const LIVE_TIMEOUT_MS = 2000; // every server call to Convex gives up after this

export function liveEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CONVEX_URL && process.env.LIVE_SYNC_SECRET);
}

export function liveSecret(): string {
  return process.env.LIVE_SYNC_SECRET ?? "";
}

let client: ConvexHttpClient | null = null;

// Created on first use. Each request is cut off after LIVE_TIMEOUT_MS.
export function liveClient(): ConvexHttpClient | null {
  if (!liveEnabled()) return null;
  client ??= new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!, {
    logger: false,
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(LIVE_TIMEOUT_MS) }),
  });
  return client;
}
