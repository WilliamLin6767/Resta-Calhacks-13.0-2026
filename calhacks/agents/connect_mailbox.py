"""One-time: connect the chat agent's Agentverse mailbox without the browser inspector.

Sends the same request the inspector's Connect button sends, to the running agents (main.py),
using AGENTVERSE_API_KEY from .env. Safe to run again.
"""

import json
import os
import urllib.error
import urllib.request

from dotenv import load_dotenv

load_dotenv()

from main import PORT, chat_agent  # noqa: E402  (builds the agents, doesn't run them)

key = os.getenv("AGENTVERSE_API_KEY", "").strip()
if not key:
    raise SystemExit("Add AGENTVERSE_API_KEY to .env first (agentverse.ai, profile, API Keys).")

req = urllib.request.Request(
    f"http://127.0.0.1:{PORT}/connect",
    method="POST",
    data=json.dumps({"user_token": key, "agent_type": "mailbox"}).encode(),
    headers={"Content-Type": "application/json", "x-uagents-address": chat_agent.address},
)
try:
    print(urllib.request.urlopen(req, timeout=60).read().decode())
except urllib.error.URLError as err:
    raise SystemExit(f"Couldn't reach the agents on port {PORT}. Is main.py running? ({err})")
