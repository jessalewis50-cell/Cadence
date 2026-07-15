import { describe, it, expect } from "vitest";
import { addMinutes, parseTimeInput } from "@/lib/time";

describe("time helpers (vitest smoke test)", () => {
  it("addMinutes adds within a day", () => {
    expect(addMinutes("09:00", 90)).toBe("10:30");
  });

  it("parseTimeInput canonicalizes meridian input", () => {
    expect(parseTimeInput("9a")).toBe("09:00");
    expect(parseTimeInput("230p")).toBe("14:30");
  });
});
