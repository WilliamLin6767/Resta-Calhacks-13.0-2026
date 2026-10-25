import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InboundEmail } from "@/lib/email/parse";
import { receiveEmail } from "@/lib/email/service";
import { aiLimited } from "@/lib/inventory/http";
import { signalAfter } from "@/lib/live/signal";
import { errorResponse, handleError } from "@/lib/purchasing/http";
import { getSupabase } from "@/lib/supabase";

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
// sending mail: a Bay Area Meat Co. invoice (a supplier on file), or a customer's pickup order.
export async function POST(request: Request) {
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
        subject: "Pickup order for tomorrow",
        text: "Hi! Could I order 3 Pho Tai and 2 orders of the egg rolls for pickup tomorrow around 6:30pm? One of the pho with no onions please. Thanks, Jamie",
        attachments: [], headers: [],
      };
    const id = await receiveEmail(await getSupabase(), email);
    signalAfter("/api/inbound/sample");
    return Response.json({ id });
  } catch (err) {
    return handleError(err);
  }
}
