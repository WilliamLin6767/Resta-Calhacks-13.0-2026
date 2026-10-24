"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

// Convex pushes changes to open screens (lib/live/ has the server side). Without
// NEXT_PUBLIC_CONVEX_URL nothing is mounted and every screen polls and fetches as before.
// The client connects lazily, on the first subscription in the browser.
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const client = url ? new ConvexReactClient(url, { logger: false }) : null;

export default function LiveProvider({ children }: { children: ReactNode }) {
  if (!client) return <>{children}</>;
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
