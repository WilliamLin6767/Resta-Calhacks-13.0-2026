"""Back of House on ASI:One: three Fetch.ai agents for Pho Berkeley's owner.

  pho-berkeley-back-of-house  the agent people chat with in ASI:One (Chat Protocol, Agentverse mailbox)
  pho-berkeley-stock-desk     today's to-do list, low stock, restock orders
  pho-berkeley-money-desk     simulated bank, cash forecast, food budget

The chat agent thinks with ASI:One's model (asi1) and calls the two desks as its tools. The desks
call the Back of House website, which does the real work. If the model is unavailable, a simple
keyword router still answers, so the owner is never left without numbers.

Run:  .venv/bin/python main.py   (see README.md)
"""

import json
import os
import re
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv

load_dotenv()  # before the local imports, which read the environment

import certifi  # noqa: E402

# python.org's Python on a Mac has no root certificates until "Install Certificates" is run;
# use certifi's so the agent can reach Agentverse and ASI:One either way
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

from openai import AsyncOpenAI  # noqa: E402
from uagents import Agent, Bureau, Context, Protocol  # noqa: E402
from uagents_core.contrib.protocols.chat import (  # noqa: E402
    ChatAcknowledgement,
    ChatMessage,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)

from desks import DeskReply, DeskRequest, _seed, money_desk, stock_desk  # noqa: E402

PORT = int(os.getenv("AGENT_PORT", "8010"))
MODEL = os.getenv("ASI1_MODEL", "asi1")
llm = AsyncOpenAI(base_url="https://api.asi1.ai/v1", api_key=os.getenv("ASI1_API_KEY")) if os.getenv("ASI1_API_KEY") else None

chat_agent = Agent(
    name="pho-berkeley-back-of-house",
    seed=_seed("CHAT_AGENT_SEED"),
    port=PORT,  # the Bureau's port, so the Agentverse inspector finds it at 127.0.0.1:PORT
    mailbox=True,  # reachable from ASI:One through Agentverse while this process runs
    publish_agent_details=True,
    description="Back-of-house assistant for Pho Berkeley, a small Vietnamese restaurant: what needs the owner today, low stock, "
    "restock orders drafted for approval, and a simulated bank check (delivery payouts, cash forecast, food budget).",
)

SYSTEM = (
    "You are Back of House, the assistant for the owner of Pho Berkeley, a small Vietnamese restaurant in Berkeley. "
    "The owner is busy and reads you on a phone between services: short answers, plain words, numbers first, no jargon. "
    "Always get numbers from your tools; never invent any, and never do your own arithmetic: quote amounts exactly as the tools give them. "
    "Only suggest things the owner can do with your tools or on the website; don't make up order changes the plan didn't offer. The bank is a simulated Capital One Nessie account, not real money: say so when you mention it. "
    "This is cash management, not investment advice: never recommend an investment. "
    "Restocking works in two steps. First call plan_restock and show the plan (suppliers, totals, warnings, cash left). "
    "Only call draft_restock after the owner clearly says yes to that plan in this conversation; drafting saves orders that still wait for their approval on the website. "
    "If a tool fails, say what failed and what they can do instead."
)

TOOLS = [
    {"type": "function", "function": {"name": "whats_needed_today", "description": "Everything that needs the owner today across inventory, prep, invoices, menu prices and accounting.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "check_low_stock", "description": "Ingredients that are low or out, with how much is left and par levels.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "plan_restock", "description": "Plan restock orders for everything low: which supplier for each item, totals, minimums, delivery dates, and the cash it leaves in the bank. Saves nothing.",
        "parameters": {"type": "object", "properties": {"leave_out": {"type": "array", "items": {"type": "string"}, "description": "Supplier names the owner doesn't want to order from"}}}}},
    {"type": "function", "function": {"name": "draft_restock", "description": "Save the restock plan as draft purchase orders for the owner's approval on the website. Only after the owner said yes to the plan.",
        "parameters": {"type": "object", "properties": {"leave_out": {"type": "array", "items": {"type": "string"}}}}}},
    {"type": "function", "function": {"name": "check_money", "description": "The simulated bank: cash after bills, money delivery apps owe, 14-day cash forecast, savings suggestion, food budget.", "parameters": {"type": "object", "properties": {}}}},
]
ROUTES = {
    "whats_needed_today": (stock_desk, "today"), "check_low_stock": (stock_desk, "low_stock"),
    "plan_restock": (stock_desk, "plan"), "draft_restock": (stock_desk, "draft"), "check_money": (money_desk, "money"),
}

# Per-conversation memory: recent turns, and whether a restock plan was shown (drafting needs one)
history: dict[str, list[dict]] = {}
planned: set[str] = set()


async def ask_desk(ctx: Context, tool: str, args: dict) -> str:
    desk, action = ROUTES[tool]
    reply, status = await ctx.send_and_receive(desk.address, DeskRequest(action=action, leave_out=args.get("leave_out") or []), response_type=DeskReply, timeout=120)
    if not isinstance(reply, DeskReply):
        return f"The {desk.name} didn't answer ({status}). Try again in a minute."
    return reply.text if reply.ok else f"That didn't work: {reply.text}"


async def run_tool(ctx: Context, sender: str, tool: str, args: dict) -> str:
    if tool == "draft_restock" and sender not in planned:
        return "Not drafted: show the owner a restock plan (plan_restock) and get their yes first."
    text = await ask_desk(ctx, tool, args)
    if tool == "plan_restock":
        planned.add(sender)
    if tool == "draft_restock":
        planned.discard(sender)
    return text


async def think(ctx: Context, sender: str, question: str) -> str:
    """ASI:One's model decides which desks to ask, up to 4 rounds, then answers."""
    turns = history.setdefault(sender, [])
    turns.append({"role": "user", "content": question})
    messages = [{"role": "system", "content": SYSTEM}, *turns[-12:]]
    for _ in range(4):
        resp = await llm.chat.completions.create(model=MODEL, messages=messages, tools=TOOLS, max_tokens=1200)
        msg = resp.choices[0].message
        if not msg.tool_calls:
            answer = msg.content or "Sorry, I don't have an answer for that."
            turns.append({"role": "assistant", "content": answer})
            return answer
        messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
        for tc in msg.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            ctx.logger.info("Tool %s %s", tc.function.name, args)
            result = await run_tool(ctx, sender, tc.function.name, args) if tc.function.name in ROUTES else f"Unknown tool {tc.function.name}."
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
    return "That took too many steps. Ask me one thing at a time."


async def fallback(ctx: Context, sender: str, question: str) -> str:
    """No model: pick a desk by keywords, and show its numbers as they are."""
    q = question.lower()
    if re.search(r"\b(yes|draft|go ahead|do it|confirm)\b", q) and sender in planned:
        tool = "draft_restock"
    elif re.search(r"order|restock|buy|supplier", q):
        tool = "plan_restock"
    elif re.search(r"low|stock|run out|inventory", q):
        tool = "check_low_stock"
    elif re.search(r"money|cash|bank|payout|savings|budget|owe", q):
        tool = "check_money"
    else:
        tool = "whats_needed_today"
    text = await run_tool(ctx, sender, tool, {})
    if tool == "plan_restock":
        text += "\n\nSay \"yes, draft it\" to save these as draft orders for your approval."
    return text


chat = Protocol(spec=chat_protocol_spec)


@chat.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(timestamp=datetime.now(timezone.utc), acknowledged_msg_id=msg.msg_id))
    if any(isinstance(c, StartSessionContent) for c in msg.content):
        history.pop(sender, None)
        planned.discard(sender)
    question = " ".join(c.text for c in msg.content if isinstance(c, TextContent)).strip()
    if not question:
        return
    ctx.logger.info("Owner: %s", question)
    try:
        answer = await think(ctx, sender, question) if llm else await fallback(ctx, sender, question)
    except Exception as err:  # the model failed: still answer with the site's numbers
        ctx.logger.exception("ASI:One model failed, using the keyword router: %s", err)
        answer = await fallback(ctx, sender, question)
    await ctx.send(sender, ChatMessage(timestamp=datetime.now(timezone.utc), msg_id=uuid4(), content=[TextContent(type="text", text=answer)]))


@chat.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


chat_agent.include(chat, publish_manifest=True)

if __name__ == "__main__":
    for a in (chat_agent, stock_desk, money_desk):
        print(f"{a.name}: {a.address}")
    # A Bureau doesn't print the inspector link, so print it here: open it once to create the mailbox
    print(f"\nConnect to ASI:One: https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A{PORT}&address={chat_agent.address}\n", flush=True)
    bureau = Bureau(port=PORT, agents=[chat_agent, stock_desk, money_desk])
    bureau.run()
