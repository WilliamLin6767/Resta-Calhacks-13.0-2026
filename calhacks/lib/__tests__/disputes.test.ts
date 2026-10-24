import { describe, expect, it } from "vitest";
import { amountToPay, disputeItems, looksLikeEmail, mailtoLink } from "../purchasing/disputes";

const flags = [
  { id: 1, kind: "math", message: "Beef bones: 3 x $57.20 = $171.60, but the line says $181.60.", money_impact: 10, resolved: false },
  { id: 2, kind: "short", message: "Eye of round: billed for 2 but only 1 delivered.", money_impact: 150, resolved: false },
  { id: 3, kind: "price_up", message: "Brisket went up 6%.", money_impact: 11, resolved: false }, // not a billing error
  { id: 4, kind: "math", message: "Old one", money_impact: 5, resolved: true },
];

describe("disputes", () => {
  it("claims only open billing errors", () => {
    const { items, total } = disputeItems(flags);
    expect(items.map((i) => i.flag_id)).toEqual([1, 2]);
    expect(total).toBe(160);
  });
  it("holds back the claim while the dispute is open, then uses the credit", () => {
    expect(amountToPay(924.6, { status: "sent", amount_claimed: 160, amount_credited: null })).toBe(764.6);
    expect(amountToPay(924.6, { status: "credited", amount_claimed: 160, amount_credited: 150 })).toBe(774.6);
    expect(amountToPay(924.6, { status: "refused", amount_claimed: 160, amount_credited: 0 })).toBe(924.6);
    expect(amountToPay(924.6, null)).toBe(924.6);
  });
  it("builds a link for the owner's email app", () => {
    expect(mailtoLink("tony@bayareameat.com", "Invoice BAM-20702", "Hi Tony,\nThanks")).toBe(
      "mailto:tony@bayareameat.com?subject=Invoice%20BAM-20702&body=Hi%20Tony%2C%0AThanks",
    );
    expect(looksLikeEmail("tony@bayareameat.com")).toBe(true);
    expect(looksLikeEmail("tony")).toBe(false);
  });
});
