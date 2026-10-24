"use client";

import { useConvex } from "convex/react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";

// The demo restaurant (RESTAURANT_ID in lib/supabase.ts, which is server only).
export const LIVE_RESTAURANT_ID = 1;

// Is Convex on in this browser? (LiveProvider mounted the Convex client.)
export function useLiveOn(): boolean {
  return useConvex() !== undefined;
}

// A Convex query subscription that is safe without Convex: with no provider (Convex off) or
// "skip" it returns undefined and does nothing. (convex/react's useQuery throws without one.)
export function useLiveQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): FunctionReturnType<Query> | undefined {
  const convex = useConvex();
  const name = getFunctionName(query);
  const key = args === "skip" ? "skip" : JSON.stringify(args);
  const [result, setResult] = useState<{ key: string; value: FunctionReturnType<Query> | undefined }>();

  useEffect(() => {
    if (!convex || key === "skip") return;
    const watch = convex.watchQuery(query, JSON.parse(key));
    const read = () => {
      try {
        setResult({ key: `${name}:${key}`, value: watch.localQueryResult() });
      } catch {
        // The query failed (e.g. a deploy in progress): keep the last result.
      }
    };
    // A result already in the client's cache doesn't trigger onUpdate, so read it once now
    read();
    return watch.onUpdate(read);
    // `query` is a new object on every render (api.live.x); its name is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convex, name, key]);

  return result?.key === `${name}:${key}` ? result.value : undefined;
}
