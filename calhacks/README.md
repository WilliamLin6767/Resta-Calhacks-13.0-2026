<p align="center">
  <a href="../README.md">
    <img src="../assets/resta-logo.png" alt="Resta" width="180" />
  </a>
</p>

# Resta app

The Next.js app behind [resta-calhacks.vercel.app](https://resta-calhacks.vercel.app). What it does, and the logo, are in [the main README](../README.md).

## Run it

Needs Node 20 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. `npm run dev:phone` serves it on your network so a phone on the same
Wi-Fi can open it.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit tests (Vitest, `lib/__tests__/`) |
| `npm run lint` | ESLint |

## Environment

Put these in `.env.local` (and in Vercel for the live site). Keys are server only unless the name
starts with `NEXT_PUBLIC_`.

| Variable | Used for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` | The database and photo storage. The secret key stays on the server. |
| `ANTHROPIC_API_KEY` | Claude: chat, agent tools, invoice reading, summaries, drafts |
| `NESSIE_API_KEY` | Capital One Nessie bank account (Accounting) |
| `WAJO_API_KEY`, `DEMO_CALL_OVERRIDE_NUMBER` | Supplier phone calls. Every call goes to the override number. |
| `CARTESIA_API_KEY` | Voice in Chat |
| `BRAVE_SEARCH_API_KEY` | Dish photos for Marketing |
| `BUFFER_API_KEY`, `BUFFER_CHANNEL_ID` | Publishing posts to Instagram |
| `APIFY_TOKEN` | Trends (Yelp, Instagram, TikTok) |
| `INBOUND_EMAIL_SECRET`, `GMAIL_CHECK_URL`, `RESTAURANT_EMAIL` | The Gmail inbox ([integrations/gmail](integrations/gmail/README.md)) |
| `PAYOUT_SUPPORT_EMAIL_DOORDASH`, `PAYOUT_SUPPORT_EMAIL_UBEREATS` | Where payout claim emails go |
| `NEXT_PUBLIC_CONVEX_URL`, `LIVE_SYNC_SECRET` | Live updates (below) |
| `CRON_SECRET` | Protects the daily loop (`/api/loop/tick`, scheduled in `vercel.json`) |
| `REQUIRE_LOGIN`, `OWNER_PASSWORD`, `SESSION_SECRET` | Optional login. Off unless `REQUIRE_LOGIN=1`. |

## Database

Supabase holds every table. The demo database is already filled with Pho Berkeley's data.
[`supabase/README.md`](supabase/README.md) describes each table. The numbered SQL files in
`supabase/` add features on top of it and are run in order in the Supabase SQL editor.

## Code layout

| Path | What's there |
| --- | --- |
| `app/` | Pages (one folder per section) and API routes (`app/api/`) |
| `components/` | Shared UI |
| `lib/` | Server logic per area (`inventory`, `purchasing`, `bank`, `marketing`, `calls`, `agent`, ...) and the tests |
| `lib/agent/` | The action log and approval gate: an action is proposed, approved by the owner, then run once |
| `convex/` | Convex functions for live updates |
| `integrations/gmail/` | The Gmail Apps Script |
| `docs/DEMO.md` | The demo script |

## Live updates (Convex)

Supabase is the database for everything. Convex only tells open screens that something changed,
so a stock count on the phone shows up on the laptop without a manual refresh.

| | Supabase | Convex |
|---|---|---|
| Holds | every table: SQL, storage, history, analytics, finance | `liveCalls` (status, progress, question, outcome of supplier calls), `liveCounts` (the call badges), `liveActions` (action status), `liveTopics` (a version number per page) |
| Written by | the app's API routes | the same routes, right after their Supabase write (`lib/live/signal.ts`), from the server only |
| Read by | server-rendered pages | the browser: `<LiveRefresh>` reloads a page when its topic goes up, the sidebar badges, the calls panels |

No transcripts, briefs, phone numbers or money tables go to Convex. Which route wakes which page
is in `lib/live/routeTopics.ts`.

- `LIVE_SYNC_SECRET` must also be set in the Convex deployment (`npx convex env set LIVE_SYNC_SECRET ...`): every Convex mutation checks it.
- Run `npx convex dev` next to `npm run dev` (it pushes `convex/` on save). After changing `convex/`, push it to the deployment the live site uses (`npx convex dev --once` for a dev deployment).
- **Resync:** `POST /api/live/resync` copies the last 7 days of supplier calls (plus any still open) and the counts from Supabase to Convex, and reloads every open screen. Rate limited.
- **Convex off:** without the env vars nothing is signalled and the app works as before: the calls panel polls every 3 seconds and pages update only in the tab that made the change. If Convex fails or takes over 2 seconds, the server logs one `[live] ...` line and the route still answers.
