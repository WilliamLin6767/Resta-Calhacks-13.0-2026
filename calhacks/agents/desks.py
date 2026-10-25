"""The two specialist agents the chat agent hands work to.

  Stock desk - what needs the owner today, low stock, and restock orders (plan, then draft)
  Money desk - the simulated bank (Capital One Nessie): cash after bills, money the apps
               didn't pay, the 14-day forecast, savings and the food budget

Each answers a DeskRequest with a DeskReply holding a short plain-text summary, so the chat
agent's model reads numbers the site worked out instead of making any up.
"""

import os

from uagents import Agent, Context, Model

import site_api


class DeskRequest(Model):
    action: str  # stock desk: today | low_stock | plan | draft; money desk: money
    leave_out: list[str] = []  # supplier names the owner doesn't want to order from


class DeskReply(Model):
    ok: bool
    text: str


def _money(n: float) -> str:
    return f"${n:,.2f}"


def _seed(name: str) -> str:
    seed = os.getenv(name)
    if not seed:
        raise RuntimeError(f"Set {name} in calhacks/agents/.env (see env.example).")
    return seed


# ---------- Stock desk ----------

stock_desk = Agent(name="pho-berkeley-stock-desk", seed=_seed("STOCK_AGENT_SEED"))


def _today_text(data: dict) -> str:
    lines = [f"Today is {data['today']}."]
    for tab in data["tabs"]:
        if tab.get("error"):
            lines.append(f"{tab['tab']}: couldn't check ({tab['error']}).")
            continue
        items = tab["items"]
        head = f"{tab['tab']}: " + (tab["headline"] or ("nothing needs you." if not items else ""))
        lines.append(head.strip())
        for i in items[:6]:
            lines.append(f"  - [{'decide now' if i['level'] == 'act' else 'keep an eye on'}] {i['title']}" + (f". {i['detail']}" if i["detail"] else ""))
        if len(items) > 6:
            lines.append(f"  - and {len(items) - 6} more on the {tab['tab']} tab")
    return "\n".join(lines)


def _low_text(data: dict) -> str:
    low = data["low_stock"]
    if not low:
        return "Nothing is low."
    rows = [f"- {l['name']}: {l['status']}, about {l['left']} left (par {l['par']})" + (f", {l['days_left']} days left" if l["days_left"] is not None else "") for l in low]
    return f"{len(low)} items low or out:\n" + "\n".join(rows)


def _plan_text(data: dict) -> str:
    plan = data["plan"]
    if not plan["groups"]:
        return "Nothing to order: no low items can be bought from a supplier with a price."
    out = [f"Restock plan, nothing saved yet. Total {_money(plan['total'])}" + (f", {_money(plan['savings'])} less than the usual suppliers." if plan["savings"] > 0.5 else ".")]
    for g in plan["groups"]:
        items = ", ".join(f"{l['choice']['packs']} x {l['choice']['pack_desc']} {l['name']}" for l in g["lines"])
        warn = f" WARNING: {_money(g['below_minimum'])} under their {_money(g['min_order_amount'])} minimum, so they may refuse it." if g["below_minimum"] > 0 else ""
        late = " Arrives late." if g["late"] else ""
        out.append(f"- {g['supplier']}: {_money(g['total'])}, arrives {g['arrives']}. {items}.{warn}{late}")
    if plan["cant_order"]:
        out.append("Can't order (no supplier price): " + ", ".join(c.get("name", "?") for c in plan["cant_order"]))
    cash = data.get("cash")
    if cash:
        left = cash["after_bills"] - plan["total"]
        below = cash["reserve"] - left
        out.append(f"Simulated bank: {_money(cash['after_bills'])} left after this week's bills; this order leaves {_money(left)}"
                   + (f", {_money(below)} below the {_money(cash['reserve'])} cash reserve." if below > 0 else f", above the {_money(cash['reserve'])} cash reserve."))
    ex = data.get("explanation")
    if ex and ex.get("summary"):
        out.append(f"Why: {ex['summary']}")
    return "\n".join(out)


async def _excluded_ids(leave_out: list[str]) -> tuple[list[int], list[str]]:
    """Supplier names the owner left out -> their ids, from the current plan."""
    if not leave_out:
        return [], []
    plan = (await site_api.plan_restock([]))["plan"]
    names = {g["supplier"].lower(): g["supplier_id"] for g in plan["groups"]}
    ids, unknown = [], []
    for name in leave_out:
        match = next((sid for sup, sid in names.items() if name.lower() in sup or sup in name.lower()), None)
        (ids.append(match) if match else unknown.append(name))
    return ids, unknown


@stock_desk.on_message(DeskRequest, replies=DeskReply)
async def stock_request(ctx: Context, sender: str, req: DeskRequest):
    try:
        if req.action == "today":
            text = _today_text(await site_api.today())
        elif req.action == "low_stock":
            text = _low_text(await site_api.today())
        elif req.action in ("plan", "draft"):
            exclude, unknown = await _excluded_ids(req.leave_out)
            note = f"(No supplier in the plan matches: {', '.join(unknown)}.)\n" if unknown else ""
            if req.action == "plan":
                text = note + _plan_text(await site_api.plan_restock(exclude))
            else:
                created = (await site_api.draft_restock(exclude)).get("created", [])
                n = len(created) if isinstance(created, list) else created
                text = note + (f"Drafted {n} purchase order(s). They wait for the owner's approval on the site's Invoices tab "
                               f"({site_api.BASE}/invoices#orders); nothing is sent to suppliers until then." if n else "Nothing was drafted: no low items to order.")
        else:
            text = f"Unknown action {req.action}."
        await ctx.send(sender, DeskReply(ok=True, text=text))
    except site_api.SiteError as err:
        ctx.logger.warning("Stock desk: %s", err)
        await ctx.send(sender, DeskReply(ok=False, text=str(err)))


# ---------- Money desk ----------

money_desk = Agent(name="pho-berkeley-money-desk", seed=_seed("MONEY_AGENT_SEED"))


def _money_text(m: dict) -> str:
    if not m.get("connected"):
        return "No bank account is connected on the site yet (Accounting tab)."
    c, f = m["cash"], m["forecast"]
    out = [
        "Simulated Capital One Nessie account (not real money).",
        f"In the bank {_money(c['balance'])}; bills due this week {_money(c['bills_due'])}; left after bills {_money(c['after_bills'])}; "
        f"cash reserve {_money(c['reserve'])} ({_money(c['spare'])} spare)." + (f" Savings: {_money(m['savings'])}." if m.get("savings") else ""),
        f"14-day forecast (an estimate): lowest {_money(f['lowest']['balance'])} on {f['lowest']['date']}; "
        f"{_money(f['money_in'])} in from payouts, {_money(f['money_out'])} out; ends at {_money(f['ends_at'])}."
        + (f" Drops below the reserve on {f['first_day_below_reserve']}." if f["first_day_below_reserve"] else " Stays above the reserve."),
    ]
    owed = m["missing_from_bank"]
    if owed:
        out.append(f"Delivery apps owe {_money(sum(o['owed'] for o in owed))}:")
        out += [f"- {o['app']}, week of {o['week_of']}: {_money(o['owed'])}. {o['note']}" for o in owed]
    s = m["savings_suggestion"]
    if s["kind"] == "now":
        out.append(f"Savings: {_money(s['amount'])} could move to savings today and every day would stay above the reserve (lowest {_money(s['lowest_after'])}). The owner moves it on the Accounting tab.")
    elif s["kind"] == "later":
        out.append(f"Savings: nothing spare today; after the {s['date']} payouts about {_money(s['amount'])} could move.")
    b = m.get("food_budget")
    if b:
        top = ", ".join(f"{t['name']} ({t['share']}%)" for t in b["top"])
        out.append(f"Food budget, last {b['days']} days: food cost {b['pct']}% of {_money(b['sales'])} sales vs a {b['target_pct']}% target, "
                   f"{_money(abs(b['left']))} {'over' if b['left'] < 0 else 'under'} budget. Biggest food costs: {top}.")
    return "\n".join(out)


@money_desk.on_message(DeskRequest, replies=DeskReply)
async def money_request(ctx: Context, sender: str, req: DeskRequest):
    try:
        text = _money_text(await site_api.money()) if req.action == "money" else f"Unknown action {req.action}."
        await ctx.send(sender, DeskReply(ok=True, text=text))
    except site_api.SiteError as err:
        ctx.logger.warning("Money desk: %s", err)
        await ctx.send(sender, DeskReply(ok=False, text=str(err)))
