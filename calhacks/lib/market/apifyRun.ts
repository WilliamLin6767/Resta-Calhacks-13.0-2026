// Start one Apify actor and return its dataset rows. The token stays on the server.
// Same wait-and-poll shape as the ThomasNet and USDA runs.

type RunData = {
  id?: string;
  status?: string;
  defaultDatasetId?: string;
};

const FINISHED = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"];

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function runFrom(body: unknown): RunData {
  if (body && typeof body === "object" && "data" in body) {
    const data = (body as { data?: RunData }).data;
    if (data && typeof data === "object") return data;
  }
  return (body ?? {}) as RunData;
}

function messageFrom(body: unknown, status: number): string {
  if (typeof body === "string" && body.trim()) return body.slice(0, 300);
  if (body && typeof body === "object" && "error" in body) {
    const error = (body as { error?: { message?: string } | string }).error;
    if (typeof error === "string") return error.slice(0, 300);
    if (error && typeof error.message === "string") return error.message.slice(0, 300);
  }
  return `Apify request failed (${status}).`;
}

// `actor` is the store id with a tilde, e.g. "api-ninja~yelp-ultimate-scraper".
export async function runActor(token: string, actor: string, input: Record<string, unknown>, itemLimit: number): Promise<unknown[]> {
  const start = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?timeout=150&waitForFinish=60`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(70_000),
  });
  const started = await readJson(start);
  if (!start.ok) throw new Error(messageFrom(started, start.status));

  let run = runFrom(started);
  for (let i = 0; i < 20 && run.status && !FINISHED.includes(run.status); i++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const poll = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    const polled = await readJson(poll);
    if (!poll.ok) throw new Error(messageFrom(polled, poll.status));
    run = runFrom(polled);
  }
  if (run.status !== "SUCCEEDED") throw new Error(`Apify run ended ${run.status ?? "without a status"}.`);
  if (!run.defaultDatasetId) throw new Error("Apify run finished without a dataset.");

  const itemsRes = await fetch(
    `https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=${itemLimit}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
  );
  const itemsBody = await readJson(itemsRes);
  if (!itemsRes.ok) throw new Error(messageFrom(itemsBody, itemsRes.status));
  return Array.isArray(itemsBody) ? itemsBody : [];
}
