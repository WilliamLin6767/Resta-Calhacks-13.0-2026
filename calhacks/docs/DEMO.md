# Resta: the 3-minute demo

**The story:** Resta finds problems on its own, investigates them with the restaurant's real data, proposes what to do, acts only when the owner taps Approve, and measures afterwards whether it helped.

## Before you go on stage

- **SQL:** run `supabase/17` to `21` in order in the Supabase SQL editor. `21_demo_loop.sql` plants the labeled demo orders. It's written for a demo between Oct 25 and Oct 28, 2026.
- **`.env.local` (or Vercel):**
  - `OWNER_PASSWORD`
  - `SESSION_SECRET` (32+ characters)
  - `SUPABASE_SECRET_KEY`
  - `ANTHROPIC_API_KEY`
  - `WAJO_API_KEY`
  - `DEMO_CALL_OVERRIDE_NUMBER`: the teammate's phone, so a real supplier is never dialed.
  - `CARTESIA_API_KEY`, for voice.
  - `CRON_SECRET`
- **Log in** on the demo laptop. Open Overview, Actions and Chat in three tabs.
- **Clear old proposals:** on the Actions page, reject anything still waiting from earlier rehearsals, so the board starts clean.
- **Teammate:** their phone is on, with the ringer up.

## The run (3 minutes)

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | **Overview**: the Today card | "This is Pho Berkeley's back office. Resta ranks what's worth the owner's time in dollars a week, worked out in code, with the basis and how sure it is." Hover a dollar figure to show its formula. |
| 0:25 | **Actions**: press **Run now** | "Resta doesn't wait to be asked. Every playbook runs: price rises, sales dips, stockouts." Wait for the result line ("2 new cases, 2 proposals for you"). |
| 0:50 | **Actions**: the Cases tab | Open the weekday lunch case. "Weekday lunch is down about 13%. It checked margins, stock for a promo week and when each dish was last posted, drafted a post and proposed a promotion. It can't run it; I have to approve." |
| 1:20 | **Chat**: hold the mic and say "Why is our beef costing so much?" | Resta answers out loud: Bay Area Meat went from $82.50 to $94 a case (and $99.50 since), the market didn't move that much, and Valley Butcher quotes $84, about $46 a week cheaper. It proposes a call, and the card shows the number it will dial. |
| 1:50 | Tap **Approve** on the call card | "Only my tap places the call; a spoken yes never does." The teammate's phone rings. The card goes to Running, then Done, live. |
| 2:20 | **Actions**: tap **Approve** on the bean sprouts order | "It drafted enough for the next week's forecast, above the supplier's minimum. Approving it here records it once, and it would refuse anything over $1,500. Once an action runs, Resta measures its case against the same weekdays before and reports association, not proof." |
| 2:45 | **Actions**: the Actions tab | "Every action is in one log: proposed, approved by whom, done, failed, and anything the owner did on a page. Nothing that spends money, changes a price or contacts anyone happens without a tap." |

## If something goes wrong

- **Voice doesn't work** (mic, Cartesia): type the same question in the chat box. The answer and the card are the same.
- **Wajo fails:** the card shows Wajo's real error and the action is logged as failed. Say so, then play the labeled recording of an earlier test call ("Recording of a test call").
- **Run now finds nothing new:** the cases from the last run are still on the Cases tab. Walk through those.
- **Run now times out:** it investigates up to 3 cases in about a minute. Press it once more; the cases already investigated are kept, and overlapping runs are safe.
- **No internet for Claude:** the Today card, the Actions log and the Cases tab still load, since they're plain code and the database.

## What's labeled as demo

- Orders with `is_demo = true`: extra weekday lunches (Oct 5 to 9) and a few weekday dinners (Oct 15 to 22).
- Missing delivery-app payouts in Accounting (planted by `07_accounting.sql`): "demo" confidence on Today.
- The "AI suggestions" card on Overview (seeded rows): "Demo data" badge.
