# Supplier calls

The app finds supplier phone calls worth making, the owner approves each one, and an AI agent
(Wajo's **Fo**) places it. Nothing is dialed without the owner's "Approve and call".

**Setup:** run `supabase/13_calls.sql` (after 01, 02 and 04). On the shared demo project the table already exists. In `.env.local`:

| | |
|---|---|
| `WAJO_API_KEY` | required, server only |
| `DEMO_CALL_OVERRIDE_NUMBER` | optional: every call goes to this number instead of the supplier's (both are recorded) |
| `RESTAURANT_EMAIL` | optional: the caller asks suppliers to confirm by email here |

## Flow

1. **Detect** (`detect.ts`, pure rules): disputes (unresolved invoice flags of $5+), orders (below
   reorder point, phone-order supplier, up to par in whole packs), questions (price up 10%+ in 30 days,
   or low stock with a non-phone supplier). One request per record; skips records with an open request
   or one rejected in the last 7 days; suppliers without a phone are listed separately.
2. **Judge** (`ai.ts`): one Claude call drops calls not worth making and writes title, reason and brief.
   Money and pack limits come from our code, not Claude.
3. **Approve** (`service.ts` `decideCall`): only from `pending`, one call at a time. The number is read
   from `suppliers.phone` at dial time (or the demo override), never from AI output.
4. **Call** (`brief.ts` + `lib/wajo/client.ts`): the brief becomes plain instructions for Fo, with fixed
   rules added: says it's an AI, only this number, no card details, no new terms, confirm in writing.
5. **Follow** (`pollCall`, `GET /api/calls/:id/status`, panel polls every 3s, Wajo at most every 5s):
   Fo sometimes stops to ask the account owner (for example a one-time go-ahead for a first call).
   Claude answers on the owner's behalf from the approved brief, at most 3 times; a different phone
   number is always refused by code. `needs_input` only appears if that answer fails, and is retried.
6. **Result**: Claude reads the conversation into `result` (reached_person, outcome, credit, new price,
   delivery, order confirmed, follow up) and a two-sentence `outcome`. Nothing is changed automatically:
   the panel offers "Mark flag resolved", "Record new price", "Mark PO sent" (`POST /api/calls/:id/apply`).

## Wajo, as found (lib/wajo/TOOLS.md)

- There is no "call this number" tool. `ask_fo` takes free text; the number goes in the message.
- Results come by polling `get_fo_reply`. There is no webhook tool, so there's no webhook route.
- The transcript is Fo's conversation (`get_fo_conversation`), which may not include every word said on the phone.
- Calls go out from the Wajo account owner's account.

## Endpoints

| | |
|---|---|
| `GET /api/calls?context_type=&context_id=` (or `supplier_id=`) | requests for one record |
| `GET /api/calls/counts` | pending counts for badges |
| `POST /api/calls/scan` | detect + judge + save pending (rate limited; also runs after an invoice is scanned) |
| `POST /api/calls/request` `{ supplier_id, text }` | the owner's own request -> pending (rate limited) |
| `POST /api/calls/:id/decide` `{ approve, brief? }` | reject, or approve and dial |
| `GET /api/calls/:id/status` | bring a running call up to date |
| `POST /api/calls/:id/apply` `{ action }` | a suggested action after the call |

The assistant (`/api/assistant`) has a `propose_call` tool: it creates a pending request and never dials.
