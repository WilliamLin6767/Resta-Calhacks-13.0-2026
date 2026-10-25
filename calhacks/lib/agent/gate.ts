// The approval gate on Supabase (server only): what the approve and reject routes and the
// owner's page buttons call. Wraps lib/agent/actions.ts with the real executors and the live
// mirror. Nothing in lib/agent/tools imports this file: the model can only propose.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clearPicture } from "@/lib/intelligence/load";
import { signalAction } from "@/lib/live/signal";
import { actNow, approve, execute, reject, supabaseActions, type ActionRow, type ActionStore, type NewAction } from "./actions";
import { executorsFor } from "./executors";

// Every status change is mirrored to Convex (id, status, tool and time only) for open screens,
// and makes the operating picture rebuild on its next read.
function liveStore(store: ActionStore): ActionStore {
  return {
    ...store,
    async insert(row) {
      const made = await store.insert(row);
      clearPicture();
      signalAction(made);
      return made;
    },
    async update(id, from, patch, notExpiredAt) {
      const row = await store.update(id, from, patch, notExpiredAt);
      if (row) {
        clearPicture();
        signalAction(row);
      }
      return row;
    },
  };
}

export const gateStore = (db: SupabaseClient) => liveStore(supabaseActions(db));

// The owner tapped Approve: approve, then run it now. The response says what happened.
export async function approveAndRun(db: SupabaseClient, id: number, owner: string): Promise<ActionRow> {
  const store = gateStore(db);
  await approve(store, id, owner);
  const { thrown: _thrown, ...row } = await execute(store, id, executorsFor(db));
  void _thrown;
  return row;
}

export async function rejectAction(db: SupabaseClient, id: number, owner: string): Promise<ActionRow> {
  return reject(gateStore(db), id, owner);
}

// An owner button on a page (Approve and call, Publish, a price): logged through the same gate.
export async function ownerAction(db: SupabaseClient, input: Omit<NewAction, "source">, owner: string) {
  return actNow(gateStore(db), { surface: "page", ...input }, owner, executorsFor(db));
}
