import { describe, expect, it } from "vitest";
import { takeTurns } from "@/lib/voice/reply";

describe("takeTurns", () => {
  it("keeps the last turns and ends on the owner", () => {
    const turns = takeTurns([
      { role: "assistant", content: "Earlier." },
      { role: "user", content: "Beef bones are low." },
      { role: "assistant", content: "Beef bones are low." },
      { role: "user", content: "Order them." },
    ]);
    expect(turns?.map((turn) => turn.role)).toEqual(["user", "assistant", "user"]);
    expect(turns?.[2].content).toBe("Order them.");
  });

  it("rejects a thread that does not end with the owner", () => {
    expect(takeTurns([{ role: "assistant", content: "Hello." }])).toBeNull();
  });
});
