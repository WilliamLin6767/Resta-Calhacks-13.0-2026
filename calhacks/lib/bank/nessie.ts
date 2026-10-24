// Capital One's Nessie API: a simulated bank (server only; the key never reaches the browser).
// Docs: https://nessieisreal.com/docs. Every request carries the key as ?key=...
// Two things the docs don't say, found by testing: amounts are stored as whole dollars
// (1080.55 becomes 1080), and deposits and transfers don't change any account's balance.
// A transfer also takes no payee, so a move to savings is a transfer out of checking plus a
// deposit into savings, and balances are worked out from our own records (lib/bank/service.ts).

const BASE = "https://prod-api.nessieisreal.com";

export class NessieError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type NessieAccount = { _id: string; type: string; nickname: string; balance: number; account_number?: string; customer_id: string };
export type NessieDeposit = { _id: string; medium: string; transaction_date: string; status: string; amount: number; description: string };

async function call<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const key = process.env.NESSIE_API_KEY;
  if (!key) throw new NessieError("Add NESSIE_API_KEY to .env.local to use the bank check.", 500);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}?key=${encodeURIComponent(key)}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new NessieError("Could not reach the Nessie bank API.", 502);
  }
  const data = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new NessieError("The Nessie API key was rejected.", 500);
  if (!res.ok) throw new NessieError(`Nessie error (${res.status}): ${data?.message ?? "unknown"}`, 502);
  // Creates answer { code, message, objectCreated }; reads answer the object itself
  return (data?.objectCreated ?? data) as T;
}

export function createCustomer(firstName: string, lastName: string) {
  return call<{ _id: string }>("POST", "/customers", {
    first_name: firstName, last_name: lastName,
    address: { street_number: "2425", street_name: "Telegraph Ave", city: "Berkeley", state: "CA", zip: "94704" },
  });
}

export function createAccount(customerId: string, nickname: string, balance: number, type: "Checking" | "Savings" = "Checking") {
  return call<NessieAccount>("POST", `/customers/${customerId}/accounts`, { type, nickname, rewards: 0, balance: Math.round(balance) });
}

export function getAccount(accountId: string) {
  return call<NessieAccount>("GET", `/accounts/${accountId}`);
}

export function listDeposits(accountId: string) {
  return call<NessieDeposit[]>("GET", `/accounts/${accountId}/deposits`);
}

export function createDeposit(accountId: string, d: { amount: number; date: string; description: string }) {
  return call<NessieDeposit>("POST", `/accounts/${accountId}/deposits`, {
    medium: "balance", transaction_date: d.date, status: "completed", amount: Math.round(d.amount), description: d.description,
  });
}

export function createTransfer(accountId: string, t: { amount: number; date: string; description: string }) {
  return call<{ _id: string }>("POST", `/accounts/${accountId}/transfers`, {
    transaction_date: t.date, status: "completed", amount: Math.round(t.amount), description: t.description,
  });
}

export function deleteTransfer(transferId: string) {
  return call<unknown>("DELETE", `/transfers/${transferId}`);
}

export function deleteDeposit(depositId: string) {
  return call<unknown>("DELETE", `/deposits/${depositId}`);
}
