# Resta: Back of House

An AI back office for small restaurants, built at Cal Hacks 13.0. Resta watches sales, stock,
supplier bills, delivery payouts and the menu together, finds the problems that cost money, drafts
the fix, and does it only when the owner taps Approve. The goal is to give owners and cooks their
time back for the cooking.

The demo runs on Pho Berkeley, a fictional Vietnamese restaurant with a few months of made-up
orders, invoices and payouts.

**Live site:** https://resta-calhacks.vercel.app (open, no login, for judging)

## What it does

| Page | What the owner gets |
| --- | --- |
| **Overview** | Today's to-do list from every page, ranked by urgency and how much money each item is worth. |
| **Intelligence** | Findings that join two or more departments (for example a billing error on a bill that isn't paid yet), each marked verified or a hypothesis, with where every dollar figure comes from. |
| **Chat** | Ask about anything in the restaurant by typing or holding the mic button. Claude answers from the restaurant's own data and can record stock counts, with Undo. |
| **Actions** | Every proposed action in one place: orders, price changes, supplier calls, disputes, posts, emails. Nothing that spends money or contacts someone runs without the owner's tap. A history of everything decided is kept. |
| **Inventory** | Stock levels against par, low and out items, and the history of every stock change. Scan or email a supplier invoice and its delivery is added to stock. |
| **Prep** | How many plates to prep, forecast from the same weekdays in past sales and adjusted for notes like "Cal home game Saturday". Catering requests that arrive by email wait here to be accepted. |
| **Menu and pricing** | Dish costs from recipes and current supplier prices, margin per plate, and suggested price changes for the menu and the delivery apps. |
| **Invoices and buying** | Every supplier bill checked line by line against the order and past prices: math errors, missing items, price increases. Drafted dispute emails and suggested orders. |
| **Suppliers** | Contacts and price history. With approval, an AI voice agent calls a supplier to dispute a charge or ask about a price, then reports back with a transcript. |
| **Trends** | Dishes that are popular nearby, from Yelp, Instagram and TikTok, compared against the menu. |
| **Marketing** | Instagram post drafts with a real photo of the dish, written for the restaurant, published to Instagram after approval. |
| **Accounting** | The restaurant's bank account (Capital One Nessie API): delivery payouts checked against the orders they should cover, short or missing payouts caught, and a drafted claim email to DoorDash or Uber Eats. QuickBooks export. |
| **Analytics** | Sales, busy hours, channels, costs, menu performance and suppliers, with an AI summary and period comparisons. |

A daily loop (a Vercel cron job) looks for new problems, opens a case for each, proposes a fix, and
after an approved fix runs, compares the same weekdays before and after.

## How it's built

- **App:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Recharts. Hosted on Vercel.
- **AI:** Claude through the Anthropic API. It runs Chat and the assistant's tool use, reads invoice
  images, writes analytics summaries, drafts posts and emails, and picks marketing photos.
- **Database:** Supabase (Postgres and storage) holds every table.
- **Live updates:** Convex tells open screens when something changed, so a stock count entered on
  a phone shows up on the laptop without a refresh.
- **Bank:** Capital One's Nessie API for the account, deposits and transfers.
- **Phone calls:** Wajo's calling agent through its MCP server. In the demo every call goes to a
  teammate's phone, never a real supplier.
- **Voice:** Cartesia for speech to text and text to speech in Chat.
- **Email:** a Google Apps Script in the restaurant's Gmail forwards supplier invoices and catering
  requests to the app.
- **Other services:** Brave Image Search (dish photos), Apify (Yelp and social trends), Buffer
  (publishing to Instagram).

## Repository

| Path | What's there |
| --- | --- |
| [`calhacks/`](calhacks) | The Next.js app. Setup and environment variables: [`calhacks/README.md`](calhacks/README.md). |
| [`calhacks/supabase/`](calhacks/supabase) | SQL files and a description of every table. |
| [`calhacks/convex/`](calhacks/convex) | The Convex functions for live updates. |
| [`calhacks/integrations/gmail/`](calhacks/integrations/gmail) | The Gmail script and how to set it up. |
| [`calhacks/docs/DEMO.md`](calhacks/docs/DEMO.md) | The 3-minute demo script. |
| [`supabase/snapshot/`](supabase/snapshot) | Exports of the demo database's structure. |

## Team

Ethan Yan, William Lin and Aaron Lin.
