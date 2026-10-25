import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InboundEmail } from "@/lib/email/parse";
import { receiveEmail } from "@/lib/email/service";
import { aiLimited } from "@/lib/inventory/http";
import { signalAfter } from "@/lib/live/signal";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";
import { requireOwner } from "@/lib/auth";

// The sample invoice image: from disk when it's there, else from this site (on Vercel, public
// files are served but not bundled with the function)
async function sampleInvoice(origin: string) {
  try {
    return (await readFile(join(process.cwd(), "public", "samples", "bay-area-meat-invoice.png"))).toString("base64");
  } catch {
    const res = await fetch(`${origin}/samples/bay-area-meat-invoice.png`);
    if (!res.ok) throw new Error("Couldn't load the sample invoice.");
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }
}

// POST /api/inbound/sample   { "kind": "invoice" | "order" }
// Runs a made-up email through the same inbox as a real one, so the feature can be tried without
// sending mail: a Bay Area Meat Co. invoice (a supplier on file), or a catering request for an office lunch.
export async function POST(request: Request) {
  const denied = requireOwner(request);
  if (denied) return denied;
  const { kind } = await request.json().catch(() => ({}));
  if (kind !== "invoice" && kind !== "order") return errorResponse("Say which sample: invoice or order.", 400);
  const limited = aiLimited(request);
  if (limited) return limited;
  const stamp = Date.now();
  try {
    const email: InboundEmail = kind === "invoice"
      ? {
        message_id: `sample-invoice-${stamp}@backofhouse.example`, from_email: "billing@bayareameat.example", from_name: "Bay Area Meat Co. Billing",
        subject: "Invoice for your delivery", text: "Hi, please find this week's invoice attached. Payment due in 14 days. Thanks, Bay Area Meat Co.",
        attachments: [{ name: "bay-area-meat-invoice.png", type: "image/png", size: 0, content: await sampleInvoice(new URL(request.url).origin) }],
        headers: [],
      }
      : {
        message_id: `sample-order-${stamp}@backofhouse.example`, from_email: "jamie.nguyen@example.com", from_name: "Jamie Nguyen",
        subject: "Catering for our office lunch Friday",
        text: "Hi! We're having a team lunch for 20 people this Friday and would love to order from you. Could we get 12 Pho Tai, " +
          "8 Pho Ga and 5 orders of the egg rolls, for pickup at 11:30am? Two of the pho with no onions please, and utensils for 20. " +
          "Thanks, Jamie (Bayside Design)",
        attachments: [], headers: [],
      };
    const id = await receiveEmail(await getSupabase(), email);
    signalAfter("/api/inbound/sample");
    return Response.json({ id });
  } catch (err) {
    return handleError(err);
  }
}
