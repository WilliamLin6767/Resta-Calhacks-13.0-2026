// Sending an email from the restaurant's own Gmail (server only), through the Gmail script's web
// app (integrations/gmail, GMAIL_CHECK_URL). Only after the owner approves it. Without the script,
// the caller falls back to a mailto: link, so the owner sends it from their own mail app.

export const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;

export type Outgoing = { to: string; subject: string; body: string; fromName?: string };

export function canSendFromGmail() {
  return !!process.env.GMAIL_CHECK_URL && !!process.env.INBOUND_EMAIL_SECRET;
}

export function mailto(e: Outgoing) {
  return `mailto:${encodeURIComponent(e.to)}?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body)}`;
}

// Sends it, or throws with a reason the owner can act on
export async function sendFromGmail(e: Outgoing): Promise<void> {
  const url = process.env.GMAIL_CHECK_URL;
  const token = process.env.INBOUND_EMAIL_SECRET;
  if (!url || !token) throw new Error("Sending from Gmail isn't set up (GMAIL_CHECK_URL).");
  let res: Response;
  try {
    // Google answers a web app POST with a redirect to the result, which fetch follows
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" }, // Apps Script reads the raw body; text/plain avoids a CORS-style preflight
      body: JSON.stringify({ token, action: "send", to: e.to, subject: e.subject, body: e.body, name: e.fromName ?? "" }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("Couldn't reach the Gmail script to send the email.");
  }
  const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!data) throw new Error("The Gmail script didn't answer as expected. Redeploy it as a new version (see integrations/gmail/README.md).");
  if (!data.ok) throw new Error(data.error === "Not allowed." ? "The Gmail script refused: its secret doesn't match INBOUND_EMAIL_SECRET." : (data.error ?? "Gmail couldn't send it."));
}
