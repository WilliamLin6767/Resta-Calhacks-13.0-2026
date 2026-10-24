import { describe, expect, it } from "vitest";
import { belowMinimum, contactLink, nextDeliveryDate, orderMessage, type OrderSupplier } from "../purchasing/orders";

const valley: OrderSupplier = {
  name: "Valley Butcher Supply", contact_name: "Maria", phone: "510-555-0103", email: null,
  preferred_channel: "phone", lead_time_days: 2, min_order_amount: 400, delivery_days: "Tue,Thu",
};
const brisket = [{ qty: 3, est_unit_price: 84, ingredient: "Brisket", pack_desc: "15 lb case" }];

describe("nextDeliveryDate", () => {
  it("waits the lead time, then the next delivery day", () => {
    // Fri Oct 23 + 2 days = Sun Oct 25; next Tue/Thu is Tue Oct 27
    expect(nextDeliveryDate("2026-10-23", valley)).toBe("2026-10-27");
  });
  it("any day when the supplier delivers daily", () => {
    expect(nextDeliveryDate("2026-10-23", { lead_time_days: 1, delivery_days: "daily" })).toBe("2026-10-24");
  });
});

describe("orders", () => {
  it("knows when an order is below the supplier's minimum", () => {
    expect(belowMinimum(brisket, valley)).toBe(148);
    expect(belowMinimum([{ ...brisket[0], qty: 5 }], valley)).toBe(0);
  });
  it("writes a short message", () => {
    expect(orderMessage("Pho Berkeley", valley, brisket, "2026-10-27")).toBe(
      "Hi Maria, this is Pho Berkeley. Can we order for Tue, Oct 27: 3 x Brisket (15 lb case). Thank you!",
    );
  });
  it("uses the supplier's preferred channel", () => {
    expect(contactLink(valley, "hi")).toEqual({ label: "Call 510-555-0103", href: "tel:5105550103" });
    expect(contactLink({ ...valley, preferred_channel: "text" }, "hi there").href).toBe("sms:5105550103?&body=hi%20there");
    expect(contactLink({ ...valley, preferred_channel: "wechat" }, "hi")).toEqual({ label: "Copy for WeChat", href: null });
  });
});
