import { describe, expect, it } from "vitest";
import {
  chartSeries,
  explainMarket,
  ingredientFamily,
  judgePriceJump,
  marketMove,
  parseReportDate,
  quoteFamily,
  type QuotePoint,
} from "@/lib/market/judge";
import { leadsFromItems, telHref } from "@/lib/market/leads";

function point(overrides: Partial<QuotePoint> & Pick<QuotePoint, "reportDate" | "priceAvg">): QuotePoint {
  return {
    reportId: 1237,
    commodity: "Feeder Cattle",
    className: "Steers",
    priceUnit: "Per Cwt",
    marketLocation: "Unionville Livestock Market LLC",
    family: "beef",
    ...overrides,
  };
}

describe("ingredientFamily", () => {
  it("maps beef cuts and dairy, and leaves produce alone", () => {
    expect(ingredientFamily("Brisket")).toBe("beef");
    expect(ingredientFamily("Beef bones")).toBe("beef");
    expect(ingredientFamily("Eye of round (rare beef)")).toBe("beef");
    expect(ingredientFamily("Whole milk")).toBe("dairy");
    expect(ingredientFamily("Limes")).toBeNull();
    expect(ingredientFamily("Whole chicken")).toBeNull();
    expect(ingredientFamily("Jasmine rice")).toBeNull();
  });
});

describe("quoteFamily", () => {
  it("keeps cattle auctions and dairy, and drops hogs and produce-shaped rows", () => {
    expect(quoteFamily({ category: "livestock_auction", commodity: "Feeder Cattle", class: "Steers" })).toBe("beef");
    expect(quoteFamily({ category: "dairy", commodity: "Milk", class: "Class I" })).toBe("dairy");
    expect(quoteFamily({ category: "livestock_auction", commodity: "Feeder Hogs", class: "Barrows" })).toBeNull();
  });
});

describe("parseReportDate", () => {
  it("accepts the actor's US dates and ISO dates", () => {
    expect(parseReportDate("07/28/2026")).toBe("2026-07-28");
    expect(parseReportDate("2026-10-09")).toBe("2026-10-09");
    expect(parseReportDate("not a date")).toBeNull();
  });
});

describe("marketMove", () => {
  const quotes = [
    point({ reportDate: "2026-09-01", priceAvg: 300 }),
    point({ reportDate: "2026-10-01", priceAvg: 310 }),
    point({ reportDate: "2026-10-20", priceAvg: 320 }),
  ];

  it("uses the latest price on or before since and the latest price after it", () => {
    const move = marketMove(quotes, "beef", "2026-10-09");
    expect(move?.fromDate).toBe("2026-10-01");
    expect(move?.toDate).toBe("2026-10-20");
    expect(move?.changePct).toBeCloseTo(3.2);
    expect(move?.location).toBe("Unionville Livestock Market LLC");
  });

  it("returns null when every quote is after the supplier change", () => {
    expect(marketMove(quotes, "beef", "2026-08-01")).toBeNull();
  });

  it("does not use a dairy series for a beef ingredient", () => {
    const dairy = [point({ family: "dairy", commodity: "Milk", reportDate: "2026-09-01", priceAvg: 20 }), point({ family: "dairy", commodity: "Milk", reportDate: "2026-10-20", priceAvg: 22 })];
    expect(marketMove(dairy, "beef", "2026-10-09")).toBeNull();
  });
});

describe("judgePriceJump", () => {
  it("calls a similar rise market-wide and says the USDA series rose", () => {
    const verdict = judgePriceJump(13.9, 12);
    expect(verdict.kind).toBe("market_wide");
    expect(verdict.detail).toMatch(/rose/i);
    expect(verdict.detail.toLowerCase()).not.toMatch(/buy from/);
  });

  it("calls a supplier jump against a flat or falling market specific to this supplier", () => {
    const verdict = judgePriceJump(13.9, -1);
    expect(verdict.kind).toBe("this_supplier");
    expect(verdict.detail).toMatch(/specific to this supplier/i);
    expect(verdict.detail.toLowerCase()).not.toMatch(/seasonal/);
    expect(verdict.detail.toLowerCase()).not.toMatch(/cheaper to buy/);
  });

  it("treats a supplier that far outruns a small market rise as this supplier", () => {
    expect(judgePriceJump(13.9, 2).kind).toBe("this_supplier");
  });

  it("does not invent a comparison when the market series is missing", () => {
    expect(judgePriceJump(13.9, null).kind).toBe("no_comparison");
  });
});

describe("chartSeries", () => {
  it("returns the dated cattle series when there are at least two prices", () => {
    const series = chartSeries(
      [
        point({ reportDate: "2026-09-01", priceAvg: 300 }),
        point({ reportDate: "2026-10-20", priceAvg: 320 }),
      ],
      "beef",
    );
    expect(series?.rows).toEqual([
      { date: "2026-09-01", price: 300 },
      { date: "2026-10-20", price: 320 },
    ]);
    expect(series?.label).toMatch(/Feeder Cattle/);
  });
});

describe("explainMarket", () => {
  const quotes = [
    point({ reportDate: "2026-09-01", priceAvg: 300 }),
    point({ reportDate: "2026-10-20", priceAvg: 339 }),
  ];

  it("covers brisket with the cattle series and leaves limes uncovered", () => {
    const brisket = explainMarket({ ingredient: "Brisket", supplierChangePct: 13.9, since: "2026-10-09", quotes });
    expect(brisket.verdict).toBe("Market-wide");
    expect(brisket.location).toMatch(/Unionville/);
    expect(brisket.dates).toBe("2026-09-01 → 2026-10-20");
    expect(brisket.detail.toLowerCase()).not.toMatch(/place to buy/);

    const limes = explainMarket({ ingredient: "Limes", supplierChangePct: 25, since: "2026-10-09", quotes });
    expect(limes.verdict).toBe("Not covered");
    expect(limes.usda).toBe("Not in these USDA reports");
  });
});

describe("leadsFromItems", () => {
  const scrapedAt = "2026-10-23T00:00:00.000Z";

  it("keeps a meat company with a phone and drops a machine and a company with no phone", () => {
    const leads = leadsFromItems("Brisket", [
      {
        name: "Bay Meat Processors",
        primaryPhone: "(510) 555-0100",
        website: "https://example.com",
        tgramsId: "1",
        address: { city: "Oakland", state: "CA" },
        products: [{ name: "Beef brisket, whole" }],
      },
      {
        name: "Lime Machine Co",
        primaryPhone: "(415) 555-0199",
        products: [{ name: "Lime slicing machine" }],
      },
      {
        name: "No Phone Meats",
        products: [{ name: "Beef brisket" }],
      },
    ], scrapedAt);

    expect(leads).toHaveLength(1);
    expect(leads[0].company_name).toBe("Bay Meat Processors");
    expect(leads[0].phone).toBe("(510) 555-0100");
    expect(leads[0].matched_product).toMatch(/brisket/i);
    expect(telHref(leads[0].phone)).toBe("tel:5105550100");
    expect(leadsFromItems("Limes", [{ name: "Lime Machine Co", primaryPhone: "(415) 555-0199", products: [{ name: "Lime slicing machine" }] }], scrapedAt)).toEqual([]);
  });
});
