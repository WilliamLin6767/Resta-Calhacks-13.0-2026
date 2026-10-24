// Phone numbers for supplier calls. The number we dial always comes from
// suppliers.phone (or the demo override), never from an AI's output.

// "510-555-0103" -> "+15105550103". US numbers by default; numbers that start
// with + are kept as international. Returns null for anything that isn't a
// usable number.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// "+14153351037" -> "(415) 335-1037" for display; other numbers as stored.
export function formatPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export type DialTarget = {
  dial: string; // the number the call goes to
  supplier_number: string; // the supplier's own number, always recorded
  override: boolean; // true when DEMO_CALL_OVERRIDE_NUMBER sent the call elsewhere
};

// Where a call to this supplier actually goes. With DEMO_CALL_OVERRIDE_NUMBER
// set, every call goes to that number instead (for demos), and both are kept.
// Null when the supplier has no usable number on file.
export function dialTarget(
  supplierPhone: string | null | undefined,
  override: string | undefined = process.env.DEMO_CALL_OVERRIDE_NUMBER
): DialTarget | null {
  const supplierNumber = normalizePhone(supplierPhone);
  if (!supplierNumber) return null;
  const demo = normalizePhone(override);
  return demo
    ? { dial: demo, supplier_number: supplierNumber, override: true }
    : { dial: supplierNumber, supplier_number: supplierNumber, override: false };
}

// Every phone number written in a piece of text, normalized. Used to check
// that the calling agent isn't asking to dial someone else.
export function phoneNumbersIn(text: string): string[] {
  const found = text.match(/\+?\d[\d\s().-]{8,}\d/g) ?? [];
  return found.map(normalizePhone).filter((n): n is string => n !== null);
}

// The first number in `text` that isn't the approved one, or null.
export function otherNumberIn(text: string, approved: string): string | null {
  return phoneNumbersIn(text).find((n) => n !== approved) ?? null;
}
