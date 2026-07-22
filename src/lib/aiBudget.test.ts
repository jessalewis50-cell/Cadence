import { describe, it, expect } from "vitest";
import {
  estimateCostMicrodollars,
  planAllowanceMicrodollars,
  billingPeriod,
  limitReachedBody,
  type TokenUsage,
} from "./aiBudget";

const NOW = new Date("2026-07-21T12:00:00Z");
const usage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  ...overrides,
});

describe("estimateCostMicrodollars", () => {
  it("prices sonnet input and output ($3/$15 per MTok)", () => {
    // 15,000 in * 3 + 200 out * 15 = 45,000 + 3,000 = 48,000 microdollars
    expect(
      estimateCostMicrodollars("claude-sonnet-4-6", usage({ input_tokens: 15_000, output_tokens: 200 }))
    ).toBe(48_000);
  });

  it("prices sonnet cache reads and writes (0.3 / 3.75 per token)", () => {
    // 10,000 read * 0.3 + 1,000 write * 3.75 = 3,000 + 3,750
    expect(
      estimateCostMicrodollars(
        "claude-sonnet-4-6",
        usage({ cache_read_tokens: 10_000, cache_write_tokens: 1_000 })
      )
    ).toBe(6_750);
  });

  it("rounds fractional microdollars up", () => {
    // 1 cache-read token * 0.3 = 0.3 -> ceil to 1
    expect(
      estimateCostMicrodollars("claude-sonnet-4-6", usage({ cache_read_tokens: 1 }))
    ).toBe(1);
  });

  it("prices haiku (dated model id) at $1/$5", () => {
    expect(
      estimateCostMicrodollars(
        "claude-haiku-4-5-20251001",
        usage({ input_tokens: 1_000, output_tokens: 100 })
      )
    ).toBe(1_500);
  });

  it("falls back to sonnet rates for unknown models (fail-expensive)", () => {
    expect(
      estimateCostMicrodollars("claude-future-9", usage({ input_tokens: 1_000 }))
    ).toBe(3_000);
  });

  it("zero usage costs zero", () => {
    expect(estimateCostMicrodollars("claude-sonnet-4-6", usage())).toBe(0);
  });
});

describe("planAllowanceMicrodollars", () => {
  it("free (no plans) gets 0", () => {
    expect(planAllowanceMicrodollars([])).toBe(0);
  });
  it("single plans get $3", () => {
    expect(planAllowanceMicrodollars(["almanac_pro"])).toBe(3_000_000);
    expect(planAllowanceMicrodollars(["cadence_pro"])).toBe(3_000_000);
  });
  it("both singles sum to $6", () => {
    expect(planAllowanceMicrodollars(["almanac_pro", "cadence_pro"])).toBe(6_000_000);
  });
  it("cadence_plus gets $8", () => {
    expect(planAllowanceMicrodollars(["cadence_plus"])).toBe(8_000_000);
  });
  it("unknown plans contribute nothing", () => {
    expect(planAllowanceMicrodollars(["enterprise"])).toBe(0);
  });
});

describe("billingPeriod", () => {
  it("null profile falls back to the current UTC calendar month", () => {
    const { start, end } = billingPeriod(null, NOW);
    expect(start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("null current_period_end also falls back to calendar month", () => {
    const { end } = billingPeriod(
      { plans: ["cadence_pro"], subscription_status: null, current_period_end: null },
      NOW
    );
    expect(end.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("a real current_period_end anchors the period one month back", () => {
    const { start, end } = billingPeriod(
      {
        plans: ["cadence_pro"],
        subscription_status: null,
        current_period_end: "2026-08-10T00:00:00Z",
      },
      NOW
    );
    expect(end.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(start.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });
});

describe("limitReachedBody", () => {
  it("has the structured shape and friendly copy", () => {
    const body = limitReachedBody("cadence_ai", {
      allowance_microdollars: 3_000_000,
      credit_microdollars: 0,
      budget_microdollars: 3_000_000,
      used_microdollars: 3_100_000,
      remaining_microdollars: 0,
      percent_used: 100,
      resets_at: "2026-08-01T00:00:00.000Z",
    });
    expect(body.code).toBe("limit_reached");
    expect(body.feature).toBe("cadence_ai");
    expect(body.used_microdollars).toBe(3_100_000);
    expect(body.budget_microdollars).toBe(3_000_000);
    expect(body.resets_at).toBe("2026-08-01T00:00:00.000Z");
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("Aug 1");
  });
});
