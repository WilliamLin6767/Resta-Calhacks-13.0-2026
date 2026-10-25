"""Calls to the Back of House website, which does the real work (orders, stock, bank).

The agents never touch the database: every number comes from the site's own API,
the same one its pages use.
"""

import os

import httpx

BASE = os.getenv("BACKOFHOUSE_URL", "https://resta-calhacks.vercel.app").rstrip("/")
# The order plan asks Claude to explain it, so it can take a while
TIMEOUT = httpx.Timeout(90.0, connect=10.0)


class SiteError(Exception):
    """The website answered with an error, or couldn't be reached."""


async def _call(method: str, path: str, body: dict | None = None) -> dict:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            res = await client.request(method, f"{BASE}{path}", json=body)
    except httpx.HTTPError as err:
        raise SiteError(f"Couldn't reach the Back of House site ({type(err).__name__}).") from err
    try:
        data = res.json()
    except ValueError:
        data = {}
    if res.status_code >= 400:
        raise SiteError(data.get("error") or f"The site answered {res.status_code}.")
    return data


async def today() -> dict:
    """What needs the owner on every tab, plus low stock."""
    return await _call("GET", "/api/agent/today")


async def money() -> dict:
    """The simulated bank and the 14-day cash plan."""
    return await _call("GET", "/api/agent/money")


async def plan_restock(exclude: list[int]) -> dict:
    """Which supplier to order each low item from. Nothing is saved."""
    return await _call("POST", "/api/orders/plan", {"kind": "low", "exclude": exclude})


async def draft_restock(exclude: list[int]) -> dict:
    """Saves the plan as draft orders, one per supplier, waiting for approval on the site."""
    return await _call("POST", "/api/orders/plan/draft", {"kind": "low", "exclude": exclude})
