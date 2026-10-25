import { describe, expect, it } from "vitest";
import { fromPostmark, invoiceAttachment, isAutoReply, matchSupplier, newText } from "../email/parse";

const suppliers = [
  { id: 2, name: "Bay Area Meat Co.", email: "billing@bayareameat.example" },
  { id: 4, name: "Delta Fresh Produce", email: "invoices@deltafresh.example" },
  { id: 9, name: "Gmail Supplier", email: "farmer.joe@gmail.com" },
  { id: 5, name: "No Email Yet", email: null },
];

// The shape Postmark's inbound webhook posts
const postmark = {
  FromFull: { Email: "Billing@BayAreaMeat.example", Name: "Bay Area Meat Billing" },
  From: "Bay Area Meat Billing <billing@bayareameat.example>",
  Subject: "Invoice BAM-20711",
  MessageID: "abc-123",
  TextBody: "Invoice attached.\n\nOn Mon, Oct 20, Jamie wrote:\n> earlier message",
  StrippedTextReply: "",
  Headers: [{ Name: "X-Spam-Score", Value: "0" }],
  Attachments: [
    { Name: "logo.png", ContentType: "image/png", Content: "aaaa", ContentLength: 3000 },
    { Name: "invoice.pdf", ContentType: "application/pdf", Content: "JVBERi0=", ContentLength: 52000 },
  ],
};

describe("fromPostmark", () => {
  it("reads the sender, subject, new text and attachments", () => {
    const e = fromPostmark(postmark)!;
    expect(e).toMatchObject({ message_id: "abc-123", from_email: "billing@bayareameat.example", from_name: "Bay Area Meat Billing", subject: "Invoice BAM-20711" });
    expect(e.text).toBe("Invoice attached."); // the quoted reply is cut
    expect(e.attachments.map((a) => a.name)).toEqual(["logo.png", "invoice.pdf"]);
  });
  it("takes the address out of From when FromFull is missing, and turns HTML into text", () => {
    const e = fromPostmark({ From: "Jamie <jamie@example.com>", Subject: "Order", HtmlBody: "<p>3 Pho Tai</p><p>for pickup</p>" })!;
    expect(e.from_email).toBe("jamie@example.com");
    expect(e.text).toContain("3 Pho Tai");
    expect(e.text).not.toContain("<p>");
  });
  it("rejects anything that isn't an email", () => {
    expect(fromPostmark(null)).toBeNull();
    expect(fromPostmark({ Subject: "no sender" })).toBeNull();
  });
});

describe("newText", () => {
  it("prefers Postmark's stripped reply and caps the length", () => {
    expect(newText("long thread", "Just the reply")).toBe("Just the reply");
    expect(newText("x".repeat(20000)).length).toBe(8000);
  });
});

describe("matchSupplier", () => {
  it("matches the exact address, ignoring case", () => {
    expect(matchSupplier("BILLING@bayareameat.example", suppliers)?.id).toBe(2);
  });
  it("matches another address at a supplier's own company domain", () => {
    expect(matchSupplier("ar@deltafresh.example", suppliers)?.id).toBe(4);
  });
  it("doesn't treat everyone at gmail.com as the same supplier", () => {
    expect(matchSupplier("farmer.joe@gmail.com", suppliers)?.id).toBe(9);
    expect(matchSupplier("stranger@gmail.com", suppliers)).toBeNull();
  });
  it("returns nothing for an unknown sender", () => {
    expect(matchSupplier("someone@else.example", suppliers)).toBeNull();
  });
});

describe("invoiceAttachment", () => {
  it("picks the PDF over a small inline logo", () => {
    expect(invoiceAttachment(fromPostmark(postmark)!.attachments)?.name).toBe("invoice.pdf");
  });
  it("skips tiny images and files it can't read", () => {
    expect(invoiceAttachment([{ name: "logo.png", type: "image/png", size: 3000, content: "a" }])).toBeNull();
    expect(invoiceAttachment([{ name: "data.xlsx", type: "application/vnd.ms-excel", size: 90000, content: "a" }])).toBeNull();
  });
  it("works out the size from the file when the sender leaves it out", () => {
    expect(invoiceAttachment([{ name: "inv.png", type: "image/png", size: 0, content: "a".repeat(40000) }])?.name).toBe("inv.png");
  });
  it("accepts a photo of an invoice, fixing image/jpg", () => {
    expect(invoiceAttachment([{ name: "inv.jpg", type: "image/jpg", size: 400000, content: "a" }])).toMatchObject({ type: "image/jpeg" });
  });
});

describe("isAutoReply", () => {
  const base = { headers: [] as { name: string; value: string }[], from_email: "kevin@goldenlotus.example" };
  it("skips out-of-office replies and bounces", () => {
    expect(isAutoReply({ ...base, subject: "Automatic reply: Order" })).toBe(true);
    expect(isAutoReply({ ...base, subject: "Out of Office until Monday" })).toBe(true);
    expect(isAutoReply({ ...base, subject: "Hi", from_email: "mailer-daemon@google.com" })).toBe(true);
    expect(isAutoReply({ ...base, subject: "Hi", headers: [{ name: "Auto-Submitted", value: "auto-replied" }] })).toBe(true);
  });
  it("keeps normal mail", () => {
    expect(isAutoReply({ ...base, subject: "Invoice for your delivery" })).toBe(false);
  });
});
