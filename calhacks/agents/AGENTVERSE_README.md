# Back of House: restaurant back-office assistant

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

Back of House runs the back office of a small restaurant from a chat. The demo restaurant is
Pho Berkeley, a Vietnamese restaurant. The owner can ask what needs attention today, check
stock, plan and draft supplier orders, and check the cash in a simulated bank account.

## What you can ask

- "What needs me today?" lists everything waiting on the owner: low stock, orders to approve,
  supplier overcharges, menu prices to raise, and delivery payouts that came up short.
- "What's running low?" lists ingredients that are low or out, with how much is left.
- "What should I order?" builds a restock plan by supplier, with totals, delivery dates and
  minimum-order warnings, and the cash it leaves in the bank.
- "Yes, draft it" saves that plan as draft purchase orders. They wait for the owner's approval
  on the website, and nothing goes to a supplier until then.
- "How's my cash?" reports the simulated bank: cash after bills, money the delivery apps owe,
  a 14-day forecast, a savings suggestion and the food budget.

## How it works

Three agents work together:

- **Back of House** (this agent) talks with you and decides what to look up.
- **Stock desk** handles the to-do list, stock levels and restock orders.
- **Money desk** handles the simulated bank, payouts and the cash forecast.

Every number comes from the Back of House web app (https://resta-calhacks.vercel.app); the
agent doesn't make numbers up. The bank is a simulated Capital One Nessie account, not real
money. This is cash management, not investment advice.

Keywords: restaurant, inventory, stock, restock, purchase orders, suppliers, invoices,
cash flow, bookkeeping, delivery payouts, DoorDash, Uber Eats, food cost, small business.

Built for Cal Hacks 13.0. Code: https://github.com/WilliamLin6767/Resta-Calhacks-13.0-2026
