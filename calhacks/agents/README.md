# Back of House on ASI:One (Fetch.ai agents)

![tag:innovationlab](https://img.shields.io/badge/innovationlab-3D8BD3)
![tag:hackathon](https://img.shields.io/badge/hackathon-5F43F1)

The owner of Pho Berkeley, a small Vietnamese restaurant, runs the back of house from an
ASI:One chat. They can ask what needs them today, check stock, plan a restock, draft the orders
and check the cash, all in one conversation. Three uAgents do the work. Behind them is the
Back of House website (https://resta-calhacks.vercel.app), which holds the real data and logic.

## Agents

| Agent | Address | What it does |
| --- | --- | --- |
| `pho-berkeley-back-of-house` (handle `@phoberkeley`) | `agent1qdsckutanf4g4q4clt4nfazwf4qn25nqtnsp8z4d65ahrf8hfn2kza9n5pr` | Chat agent on Agentverse, reachable from ASI:One (Chat Protocol). Thinks with ASI:One's `asi1` model and calls the two desks as tools. |
| `pho-berkeley-stock-desk` | `agent1qtllrmgy9fm3h44lf0m53rd8pxr5p5wnjn2rkmgx6ntkdlld3psmkddtrx2` | What needs the owner on every tab, low stock, and restock orders (plan, then draft for approval). |
| `pho-berkeley-money-desk` | `agent1qv5eltuyly9l5afsu7qyzmyqfp68jsytqrxq3v90z4qce42d6uuuyw36093` | Simulated bank (Capital One Nessie): cash after bills, money the delivery apps owe, 14-day cash forecast, savings, food budget. |

Chat with it: https://asi1.ai/ai/agent1qdsckutanf4g4q4clt4nfazwf4qn25nqtnsp8z4d65ahrf8hfn2kza9n5pr (or type `@phoberkeley` in ASI:One).

## The workflow in ASI:One

1. "What needs me today?" The stock desk gathers every tab's to-do list.
2. "What should I order?" The stock desk plans restock orders by supplier, with totals, minimums
   and delivery dates. The plan also shows the cash the order leaves in the bank compared with the
   owner's reserve.
3. "Yes, draft it." The orders are saved as drafts on the site's Invoices tab. Nothing goes to a
   supplier until the owner approves it there. The agent only drafts after it has shown a plan in
   the same conversation.
4. "How's my cash?" The money desk reports the simulated bank, the money the delivery apps owe and
   the 14-day forecast.

The agents read their numbers from the site and never make them up. If ASI:One's model is
unavailable, a keyword router still answers with the site's numbers. If a desk or the site fails,
the agent says what failed.

## Run it

Needs Python 3.10 to 3.13. On a Mac with Python 3.14, use 3.11.

```bash
cd calhacks/agents
python3.11 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp env.example .env   # then fill it in: an ASI:One API key, and three long random seed phrases
.venv/bin/python main.py
```

The first time, open the "Connect to ASI:One" link it prints. Sign in to Agentverse, click
**Connect**, then **Mailbox**. The chat agent then shows on Agentverse and can be found from
ASI:One, but only while `main.py` is running.

If the inspector says "Could not find this Agent on your local host" (the browser can be
blocked from reaching your machine), connect from Terminal instead. Put an Agentverse API key
in `.env` as `AGENTVERSE_API_KEY`, keep `main.py` running, and in a second Terminal run:

```bash
.venv/bin/python connect_mailbox.py
```

Each agent's address comes from its seed phrase. New seeds give new addresses, and the table
above needs updating.
