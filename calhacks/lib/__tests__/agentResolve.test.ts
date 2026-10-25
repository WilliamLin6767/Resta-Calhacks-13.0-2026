import { describe, expect, it } from "vitest";
import { outlierQuestion, resolveInvoice, resolveOne, toIngredientQty } from "@/lib/agent/resolve";
import { dayToDate } from "@/lib/agent/tools/prep";

const ingredients = [
  { id: 1, name: "Limes" },
  { id: 2, name: "Yellow onion" },
  { id: 3, name: "Green onion" },
  { id: 4, name: "Beef bones" },
  { id: 5, name: "Lime leaves" },
];
const name = (i: { name: string }) => i.name;

describe("resolveOne", () => {
  it('finds Limes from "lime" and "limes" (an exact name beats "Lime leaves")', () => {
    expect(resolveOne(ingredients, "lime", name, "ingredient")).toEqual({ ok: true, item: ingredients[0] });
    expect(resolveOne(ingredients, "limes", name, "ingredient")).toEqual({ ok: true, item: ingredients[0] });
    expect(resolveOne(ingredients, "LIMES ", name, "ingredient")).toMatchObject({ ok: true, item: { id: 1 } });
  });

  it("asks which one when two match", () => {
    expect(resolveOne(ingredients, "onion", name, "ingredient")).toEqual({ ok: false, ask: "Which one: Yellow onion or Green onion?" });
    expect(resolveOne(ingredients, "green onions", name, "ingredient")).toMatchObject({ ok: true, item: { id: 3 } });
  });

  it("asks about an unknown name instead of guessing", () => {
    const r = resolveOne(ingredients, "saffron", name, "ingredient");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.ask).toContain('couldn\'t find an ingredient called "saffron"');
    expect(resolveOne(ingredients, "  ", name, "ingredient")).toEqual({ ok: false, ask: "Which ingredient?" });
  });

  it("resolves suppliers and dishes the same way", () => {
    const suppliers = [{ name: "Valley Butcher Supply" }, { name: "Bay Area Meat Co." }, { name: "Delta Fresh Produce" }];
    expect(resolveOne(suppliers, "valley butcher", name, "supplier")).toMatchObject({ ok: true, item: { name: "Valley Butcher Supply" } });
    expect(resolveOne(suppliers, "meat", name, "supplier")).toMatchObject({ ok: true, item: { name: "Bay Area Meat Co." } });
    expect(resolveOne(suppliers, "sysco", name, "supplier").ok).toBe(false);
    const dishes = [{ name: "Pho Tai" }, { name: "Pho Ga" }, { name: "Banh Mi" }];
    expect(resolveOne(dishes, "pho", name, "dish")).toEqual({ ok: false, ask: "Which one: Pho Tai or Pho Ga?" });
    expect(resolveOne(dishes, "banh mi", name, "dish")).toMatchObject({ ok: true, item: { name: "Banh Mi" } });
  });
});

describe("resolveInvoice", () => {
  const invoices = [
    { id: 12, invoice_number: "BAM-20702", invoice_date: "2026-10-20", supplier: "Bay Area Meat Co." },
    { id: 14, invoice_number: "SY-881", invoice_date: "2026-10-18", supplier: "Sysco" },
    { id: 15, invoice_number: "SY-902", invoice_date: "2026-10-23", supplier: "Sysco" },
  ];
  it("takes a number, an id, or the latest from a supplier", () => {
    expect(resolveInvoice(invoices, "BAM-20702")).toMatchObject({ ok: true, item: { id: 12 } });
    expect(resolveInvoice(invoices, "#14")).toMatchObject({ ok: true, item: { id: 14 } });
    expect(resolveInvoice(invoices, "the latest Sysco invoice")).toMatchObject({ ok: true, item: { id: 15 } });
    expect(resolveInvoice(invoices, "bay area meat")).toMatchObject({ ok: true, item: { id: 12 } });
  });
  it("asks which when a supplier has several and no 'latest'", () => {
    const r = resolveInvoice(invoices, "sysco invoice");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.ask).toContain("Which Sysco invoice");
  });
  it("says which suppliers there are when none matches", () => {
    expect(resolveInvoice(invoices, "the latest Valley Butcher invoice")).toEqual({
      ok: false,
      ask: 'I don\'t see any invoice from "valley butcher". Invoices are from Bay Area Meat Co. or Sysco. Which one did you mean?',
    });
  });
});

describe("units", () => {
  const limes = { name: "Limes", unit: "lb", pack_qty: 30, pack_desc: "30 lb case" };
  it('"2 cases" with a pack of 30 is 60', () => {
    expect(toIngredientQty(2, "cases", limes)).toMatchObject({ ok: true, qty: 60 });
    expect(toIngredientQty(12, undefined, limes)).toEqual({ ok: true, qty: 12 });
    expect(toIngredientQty(12, "pounds", limes)).toEqual({ ok: true, qty: 12 });
    expect(toIngredientQty(32, "oz", limes)).toMatchObject({ ok: true, qty: 2 });
  });
  it("asks when the pack size is unknown or the unit doesn't convert", () => {
    const bones = { name: "Beef bones", unit: "lb", pack_qty: null };
    expect(toIngredientQty(2, "cases", bones)).toEqual({ ok: false, ask: "How many lb are in a case of Beef bones?" });
    expect(toIngredientQty(3, "bunches", { name: "Cilantro", unit: "lb", pack_qty: null }).ok).toBe(false);
    expect(toIngredientQty(-1, undefined, limes).ok).toBe(false);
  });
});

describe("outliers", () => {
  const line = { name: "Limes", unit: "lb", par: 20, expected: 15 };
  it("asks above 3x par or 5x what we expected", () => {
    expect(outlierQuestion(60, line)).toBeNull(); // exactly 3x par
    expect(outlierQuestion(61, line)).toContain("Did you mean 61 lb of Limes? That's a lot (par is 20 lb)");
    expect(outlierQuestion(76, { ...line, par: 100 })).toContain("we expected about 15 lb");
    expect(outlierQuestion(75, { ...line, par: 100 })).toBeNull(); // exactly 5x expected
  });
  it("with no par uses only what we expected, and with neither never asks", () => {
    expect(outlierQuestion(76, { ...line, par: null })).toContain("expected");
    expect(outlierQuestion(74, { ...line, par: null })).toBeNull();
    expect(outlierQuestion(1000, { ...line, par: null, expected: 0 })).toBeNull();
  });
});

describe("dayToDate", () => {
  it("reads today, tomorrow and weekday names", () => {
    expect(dayToDate("today", "2026-10-24")).toBe("2026-10-24");
    expect(dayToDate("tomorrow", "2026-10-24")).toBe("2026-10-25");
    expect(dayToDate("Saturday", "2026-10-24")).toBe("2026-10-31"); // 10-24 is a Saturday: the next one
    expect(dayToDate("mon", "2026-10-24")).toBe("2026-10-26");
    expect(dayToDate("someday", "2026-10-24")).toBeNull();
  });
});
