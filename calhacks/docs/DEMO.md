# Resta: the 3-minute demo

**The story:** One assistant understands the whole restaurant. Resta joins sales, inventory, purchasing, finance, marketing and the menu into one operating picture, finds problems that cross departments, explains the evidence, proposes what to do, acts only when the owner taps Approve, and measures afterwards whether it helped.

**The 30-second version for a judge:** open **Intelligence**. Every card there joins at least two departments, says whether it's verified or a hypothesis, and shows where each dollar figure comes from. "Investigate with Resta" opens the same assistant, which already has this picture in its prompt and can pull any card's full evidence.

## Before you go on stage

- **SQL:** run `supabase/17` to `21` in order in the Supabase SQL editor. `21_demo_loop.sql` plants the labeled demo orders. It's written for a demo between Oct 25 and Oct 28, 2026.
- **`.env.local` (or Vercel):**
  - There is no login: anyone with the link can use the site (for the judges). To require one, set `REQUIRE_LOGIN=1` plus `OWNER_PASSWORD` and `SESSION_SECRET` (32+ characters).
  - `SUPABASE_SECRET_KEY`
  - `ANTHROPIC_API_KEY`
  - `WAJO_API_KEY`
  - `DEMO_CALL_OVERRIDE_NUMBER`: the teammate's phone, so a real supplier is never dialed.
  - `CARTESIA_API_KEY`, for voice.
  - `CRON_SECRET`
- **On the demo laptop**, open Intelligence, Chat and Actions in three tabs. Load Intelligence once beforehand: the first build of the picture takes about 5 seconds, then it's cached for 5 minutes.
- **Clear old proposals:** on the Actions page, reject anything still waiting from earlier rehearsals, so the board starts clean.
- **Teammate:** their phone is on, with the ringer up.

## The run (3 minutes)

| Time | On screen | Say |
| --- | --- | --- |
| 0:00 | **Intelligence**: the four numbers at the top | "This is everything Resta knows about Pho Berkeley right now, computed from the database a minute ago: how many cross-department discoveries, the verified money at stake each week, what's waiting for my approval, and which departments are feeding it. No made-up scores." |
| 0:20 | **Intelligence**: the first discovery, the billing error | "Purchasing and finance together: the invoice check found $160 overcharged on a Bay Area Meat bill, and that bill isn't paid yet. Verified: every part is a recorded number. It's easiest to get money back before you pay." |
| 0:40 | **Intelligence**: the limes or brisket card | "A supplier price rise that cuts into four dishes. Resta shows the price, the weekly use, the cost per plate and the formula behind $34 a week. It's linked to the case the loop already opened, so it doesn't start a second one." |
| 1:00 | **Intelligence**: "What Resta knows" | Click **Menu**, then **Finance**. "These are exactly the numbers the assistant gets in its prompt, how fresh they are, and the tools it uses to dig deeper. The lines between departments only appear where a discovery really joins them." |
| 1:20 | Billing card: **Investigate with Resta** | Chat opens and asks for you. Resta explains the evidence, saves the dispute draft, and proposes sending it. "It can draft. It can't send; sending contacts the supplier, so that waits for me in Actions." |
| 1:50 | **Actions**: the **Mixed** section | "Every approval in the app is here, by department. This one is under Mixed because it came from a discovery that joins purchasing and finance." Tap **Approve**: the email opens to send, and it's logged Done, live. Back on **Intelligence** (refresh): the billing discovery is gone. |
| 2:15 | **Chat**: "Why is our beef costing so much?" (typed or by mic) | Resta pulls the brisket evidence across purchasing, market prices and the menu, and proposes a call. "Only my tap in Actions places a call; a spoken yes never does." Approve it under Purchasing and suppliers: the teammate's phone rings (`DEMO_CALL_OVERRIDE_NUMBER`). |
| 2:45 | **Actions**: History | "Everything decided is in one log: approved by whom, done, failed. Other pages only show context and link here. When an action runs, its case is measured against the same weekdays before, and reported as association, not proof." |

## If something goes wrong

- **Voice doesn't work** (mic, Cartesia): type the same question in the chat box. The answer and the card are the same.
- **Wajo fails:** the card shows Wajo's real error and the action is logged as failed. Say so, then play the labeled recording of an earlier test call ("Recording of a test call").
- **A discovery you expected isn't there:** that's on purpose. Each card only appears when every part of the link is in the data (for example, a promotion card needs a sales dip, a dish above the average margin, stock for a promotion week and no recent post). Use the cards that are there.
- **Run now finds nothing new:** the cases from the last run are still on the Cases tab. Walk through those.
- **Run now times out:** it investigates up to 3 cases in about a minute. Press it once more; the cases already investigated are kept, and overlapping runs are safe.
- **No internet for Claude:** Intelligence, the Today card, the Actions log and the Cases tab still load, since they're plain code and the database.

## What's labeled as demo

- Orders with `is_demo = true`: extra weekday lunches (Oct 5 to 9) and a few weekday dinners (Oct 15 to 22).
- Missing delivery-app payouts in Accounting (planted by `07_accounting.sql`): "demo" confidence on Today.
- The "AI suggestions" card on Overview (seeded rows): "Demo data" badge.
