import { describe, it, expect } from "vitest";
import { deriveEntitlements, upgradeRequiredBody, type ProfileRow } from "./entitlements";

const NOW = new Date("2026-07-21T12:00:00Z");
const profile = (overrides: Partial<ProfileRow> = {}): ProfileRow => ({
  plans: [],
  subscription_status: null,
  current_period_end: null,
  ...overrides,
});

describe("deriveEntitlements", () => {
  it("free (empty plans) has nothing", () => {
    expect(deriveEntitlements(profile(), NOW)).toEqual({
      cadenceAI: false,
      almanacAI: false,
      almanacIntegration: false,
    });
  });

  it("missing profile row has nothing", () => {
    expect(deriveEntitlements(null, NOW).cadenceAI).toBe(false);
  });

  it("almanac_pro grants almanac AI only", () => {
    const e = deriveEntitlements(profile({ plans: ["almanac_pro"] }), NOW);
    expect(e).toEqual({ cadenceAI: false, almanacAI: true, almanacIntegration: false });
  });

  it("cadence_pro grants cadence AI only", () => {
    const e = deriveEntitlements(profile({ plans: ["cadence_pro"] }), NOW);
    expect(e).toEqual({ cadenceAI: true, almanacAI: false, almanacIntegration: false });
  });

  it("almanac_pro + cadence_pro combine", () => {
    const e = deriveEntitlements(profile({ plans: ["almanac_pro", "cadence_pro"] }), NOW);
    expect(e).toEqual({ cadenceAI: true, almanacAI: true, almanacIntegration: false });
  });

  it("cadence_plus grants everything", () => {
    const e = deriveEntitlements(profile({ plans: ["cadence_plus"] }), NOW);
    expect(e).toEqual({ cadenceAI: true, almanacAI: true, almanacIntegration: true });
  });

  it("null current_period_end is valid through end of current month (UTC)", () => {
    const lastInstant = new Date("2026-07-31T23:59:59Z");
    expect(deriveEntitlements(profile({ plans: ["cadence_pro"] }), lastInstant).cadenceAI).toBe(true);
  });

  it("expired current_period_end revokes", () => {
    const e = deriveEntitlements(
      profile({ plans: ["cadence_pro"], current_period_end: "2026-07-01T00:00:00Z" }),
      NOW
    );
    expect(e.cadenceAI).toBe(false);
  });

  it("future current_period_end stays valid", () => {
    const e = deriveEntitlements(
      profile({ plans: ["cadence_pro"], current_period_end: "2026-09-01T00:00:00Z" }),
      NOW
    );
    expect(e.cadenceAI).toBe(true);
  });

  it("canceled/past_due status revokes; null and active/trialing do not", () => {
    expect(
      deriveEntitlements(profile({ plans: ["cadence_pro"], subscription_status: "canceled" }), NOW).cadenceAI
    ).toBe(false);
    expect(
      deriveEntitlements(profile({ plans: ["cadence_pro"], subscription_status: "past_due" }), NOW).cadenceAI
    ).toBe(false);
    expect(
      deriveEntitlements(profile({ plans: ["cadence_pro"], subscription_status: "active" }), NOW).cadenceAI
    ).toBe(true);
    expect(
      deriveEntitlements(profile({ plans: ["cadence_pro"], subscription_status: "trialing" }), NOW).cadenceAI
    ).toBe(true);
  });

  it("unknown plan slugs are ignored", () => {
    expect(deriveEntitlements(profile({ plans: ["enterprise"] }), NOW).cadenceAI).toBe(false);
  });
});

describe("upgradeRequiredBody", () => {
  it("names the plans that unlock the feature", () => {
    expect(upgradeRequiredBody("cadence_ai").required_plans).toEqual(["cadence_pro", "cadence_plus"]);
    expect(upgradeRequiredBody("almanac_ai").required_plans).toEqual(["almanac_pro", "cadence_plus"]);
    expect(upgradeRequiredBody("cadence_ai").code).toBe("upgrade_required");
  });
});
