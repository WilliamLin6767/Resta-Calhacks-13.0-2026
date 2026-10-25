// Email inbox: turning an incoming email into something the app can use. Pure functions, no
// database or AI. The email arrives from Postmark's inbound webhook (lib/email/service.ts).
//   fromPostmark      - Postmark's JSON -> our InboundEmail, or null if it isn't one
//   matchSupplier     - is the sender one of the restaurant's suppliers?
//   invoiceAttachment - the attachment worth reading as an invoice (a PDF or photo)
//   isAutoReply       - out-of-office replies and bounces, which are skipped

export type Attachment = { name: string; type: string; size: number; content: string }; // content: base64
export type InboundEmail = {
  message_id: string;
  from_email: string;
  from_name: string;
  subject: string;
  text: string;
  attachments: Attachment[];
  headers: { name: string; value: string }[];
};

// The most of an email's text the AI reads (a long quoted thread adds nothing)
export const MAX_BODY_CHARS = 8000;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const INVOICE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];

const str = (v: unknown) => (typeof v === "string" ? v : "");

// The new part of the message: Postmark's StrippedTextReply if it has one, else the text body
// cut at the first quoted reply ("On ... wrote:" or a line of ">").
export function newText(text: string, stripped = "") {
  const body = (stripped.trim() || text).replace(/\r\n/g, "\n");
  const cut = body.search(/^(On .+ wrote:|>.*|-{2,}\s*Original Message\s*-{2,})$/im);
  return (cut > 0 ? body.slice(0, cut) : body).trim().slice(0, MAX_BODY_CHARS);
}

function htmlToText(html: string) {
  return html.replace(/<(br|\/p|\/div|\/tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ");
}

export function fromPostmark(body: unknown): InboundEmail | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const full = (b.FromFull ?? {}) as Record<string, unknown>;
  const from_email = (str(full.Email) || str(b.From).replace(/^.*<([^>]+)>.*$/, "$1")).trim().toLowerCase();
  if (!from_email.includes("@")) return null;
  const text = str(b.TextBody) || htmlToText(str(b.HtmlBody));
  const attachments = (Array.isArray(b.Attachments) ? b.Attachments : [])
    .map((a: Record<string, unknown>) => ({
      name: str(a.Name) || "attachment", type: str(a.ContentType).toLowerCase(),
      size: Number(a.ContentLength) || Math.floor((str(a.Content).length * 3) / 4), content: str(a.Content),
    }))
    .filter((a) => a.content);
  return {
    message_id: str(b.MessageID) || str(b.MessageId) || `${from_email}:${str(b.Date)}:${str(b.Subject)}`,
    from_email,
    from_name: str(full.Name) || str(b.FromName),
    subject: str(b.Subject).slice(0, 300),
    text: newText(text, str(b.StrippedTextReply)),
    attachments,
    headers: (Array.isArray(b.Headers) ? b.Headers : []).map((h: Record<string, unknown>) => ({ name: str(h.Name), value: str(h.Value) })),
  };
}

// Big email providers: a shared domain says nothing about who the sender is
const SHARED_DOMAINS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "qq.com", "163.com"]);

export type SupplierRef = { id: number; name: string; email: string | null };

// The supplier whose address this is, or who uses the same company domain
export function matchSupplier(fromEmail: string, suppliers: SupplierRef[]): SupplierRef | null {
  const from = fromEmail.trim().toLowerCase();
  const domain = from.split("@")[1] ?? "";
  const withEmail = suppliers.filter((s) => s.email);
  return (
    withEmail.find((s) => s.email!.trim().toLowerCase() === from) ??
    (domain && !SHARED_DOMAINS.has(domain) ? withEmail.find((s) => s.email!.trim().toLowerCase().split("@")[1] === domain) : undefined) ??
    null
  );
}

// The first PDF or photo small enough to read
export function invoiceAttachment(attachments: Attachment[]): Attachment | null {
  const type = (a: Attachment) => (a.type === "image/jpg" ? "image/jpeg" : a.type);
  // The size as sent, else worked out from the base64 (some senders leave it out)
  const size = (a: Attachment) => a.size || Math.floor((a.content.length * 3) / 4);
  const ok = attachments.filter((a) => INVOICE_TYPES.includes(type(a)) && size(a) <= MAX_ATTACHMENT_BYTES);
  // A PDF is more likely the invoice than an inline logo
  const pick = ok.find((a) => type(a) === "application/pdf") ?? ok.find((a) => size(a) > 20_000) ?? null;
  return pick && { ...pick, type: type(pick) };
}

export function isAutoReply(e: Pick<InboundEmail, "subject" | "headers" | "from_email">) {
  const header = (n: string) => e.headers.find((h) => h.name.toLowerCase() === n)?.value.toLowerCase() ?? "";
  if (header("auto-submitted") && header("auto-submitted") !== "no") return true;
  if (/^(auto_reply|bulk|junk|list)$/.test(header("precedence"))) return true;
  if (/^(mailer-daemon|postmaster|no-?reply)@/i.test(e.from_email)) return true;
  return /^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|undeliverable|delivery status notification|mail delivery failed)/i.test(e.subject.trim());
}
