This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Live updates (Convex)

Supabase is the database for everything. Convex only tells open screens that something changed,
so a stock count on the phone shows up on the laptop without a manual refresh.

| | Supabase | Convex |
|---|---|---|
| Holds | every table: SQL, storage, history, analytics, finance | `liveCalls` (status, progress, question, outcome of supplier calls), `liveCounts` (the call badges), `liveTopics` (a version number per page) |
| Written by | the app's API routes, as before | the same routes, right after their Supabase write (`lib/live/signal.ts`), from the server only |
| Read by | server-rendered pages | the browser: `<LiveRefresh>` reloads a page when its topic goes up, the sidebar badges, the calls panels |

No transcripts, briefs, phone numbers or money tables go to Convex. Which route wakes which page
is in `lib/live/routeTopics.ts`; the functions are in `convex/`.

**Env** (`.env.local`):

| | |
|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | the deployment URL, written by `npx convex dev` |
| `LIVE_SYNC_SECRET` | server only, never `NEXT_PUBLIC_`. Also set it in the Convex deployment (`npx convex env set LIVE_SYNC_SECRET ...`): every Convex mutation checks it |

Run `npx convex dev` next to `npm run dev` (it pushes `convex/` on save).

**Resync:** `POST /api/live/resync` copies the last 7 days of supplier calls (plus any still open)
and the counts from Supabase to Convex, and reloads every open screen. Use it after Convex was off
or missed something. Rate limited.

**Convex off:** without either env var nothing is signalled, the Convex provider isn't mounted,
and the app works as before: the calls panel polls every 3 seconds, the badges fetch
`/api/calls/counts`, and pages update only in the tab that made the change. Signalling is best
effort either way: if Convex fails or takes over 2 seconds, the server logs one `[live] ...` line
and the route still answers as usual.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
