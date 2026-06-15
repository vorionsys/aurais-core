import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  deriveAgentIdentity,
  OBSERVATION_CEILING,
  OBSERVATION_MAX_TIER,
  TIER_NAME,
  type DeriveInput,
} from "../src/car-identity.js";

const SAMPLE: DeriveInput = {
  slug: "aurais-test-bot",
  version: "0.1.0",
  name: "Test Bot",
  tier: 3,
  observationClass: "BLACK_BOX",
  maxEarnableTier: 4,
  capabilities: ["tool:read", "data:read:public"],
};

describe("OBSERVATION_CEILING and TIER_NAME", () => {
  it("matches canonical.ts observation ceilings", () => {
    expect(OBSERVATION_CEILING.BLACK_BOX).toBe(600);
    expect(OBSERVATION_CEILING.GRAY_BOX).toBe(750);
    expect(OBSERVATION_CEILING.WHITE_BOX).toBe(900);
    expect(OBSERVATION_CEILING.ATTESTED_BOX).toBe(950);
    expect(OBSERVATION_CEILING.VERIFIED_BOX).toBe(1000);
  });

  it("maps observation class to a max earnable tier", () => {
    expect(OBSERVATION_MAX_TIER.BLACK_BOX).toBe(3);
    expect(OBSERVATION_MAX_TIER.GRAY_BOX).toBe(4);
    expect(OBSERVATION_MAX_TIER.VERIFIED_BOX).toBe(7);
  });

  it("uses the earned-trust-tier names (orthogonal to observation class)", () => {
    expect(TIER_NAME[0]).toBe("Sandbox");
    expect(TIER_NAME[3]).toBe("Monitored");
    expect(TIER_NAME[7]).toBe("Autonomous");
  });
});

describe("deriveAgentIdentity", () => {
  beforeEach(() => {
    delete process.env.AURAIS_DEPLOYMENT_ID;
    delete process.env.VERCEL_DEPLOYMENT_ID;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });
  afterEach(() => {
    delete process.env.AURAIS_DEPLOYMENT_ID;
    delete process.env.VERCEL_DEPLOYMENT_ID;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("returns the expected shape", () => {
    const id = deriveAgentIdentity(SAMPLE);
    expect(id.carId).toMatch(/^car-aurais-test-bot-[0-9a-f]{12}$/);
    expect(id.agentId).toBe("aurais-test-bot@0.1.0");
    expect(id.operationId).toMatch(/^[0-9a-f]{16}$/);
    expect(id.orgId).toBe("vorion-llc");
    expect(id.contextHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(id.parentHash).toBe("");
    expect(id.observationClass).toBe("BLACK_BOX");
    // Ceiling derives from the observation class, not the trust tier.
    expect(id.trustCeiling).toBe(600);
    expect(id.startingTier).toBe(0);
    // maxEarnableTier is clamped to the observation-class max (BLACK_BOX -> 3),
    // even though the input requested 4.
    expect(id.maxEarnableTier).toBe(3);
    expect(id.currentTier).toBe(3);
    expect(id.capabilities).toEqual(["tool:read", "data:read:public"]);
    expect(id.registrationStatus).toBe("self-asserted");
  });

  it("produces a stable carId for the same input", () => {
    const a = deriveAgentIdentity(SAMPLE);
    const b = deriveAgentIdentity(SAMPLE);
    expect(a.carId).toBe(b.carId);
    expect(a.contextHash).toBe(b.contextHash);
  });

  it("binds observationClass into the digest — a class change yields a new carId", () => {
    const blackBox = deriveAgentIdentity(SAMPLE);
    const grayBox = deriveAgentIdentity({ ...SAMPLE, observationClass: "GRAY_BOX" });
    expect(grayBox.carId).not.toBe(blackBox.carId);
    expect(grayBox.contextHash).not.toBe(blackBox.contextHash);
    expect(grayBox.trustCeiling).toBe(750);
  });

  it("produces a different operationId on each call", () => {
    const a = deriveAgentIdentity(SAMPLE);
    const b = deriveAgentIdentity(SAMPLE);
    expect(a.operationId).not.toBe(b.operationId);
  });

  it("contextHash is order-insensitive over capabilities", () => {
    const a = deriveAgentIdentity({ ...SAMPLE, capabilities: ["a", "b", "c"] });
    const b = deriveAgentIdentity({ ...SAMPLE, capabilities: ["c", "a", "b"] });
    expect(a.contextHash).toBe(b.contextHash);
  });

  it("AURAIS_DEPLOYMENT_ID wins over Vercel envs", () => {
    process.env.AURAIS_DEPLOYMENT_ID = "explicit-id";
    process.env.VERCEL_DEPLOYMENT_ID = "vercel-id";
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef0123456789abcdef";
    expect(deriveAgentIdentity(SAMPLE).deploymentId).toBe("explicit-id");
  });

  it("falls back to VERCEL_DEPLOYMENT_ID when AURAIS not set", () => {
    process.env.VERCEL_DEPLOYMENT_ID = "vercel-id";
    expect(deriveAgentIdentity(SAMPLE).deploymentId).toBe("vercel-id");
  });

  it("falls back to first 12 chars of VERCEL_GIT_COMMIT_SHA", () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef0123456789abcdef";
    expect(deriveAgentIdentity(SAMPLE).deploymentId).toBe("abcdef012345");
  });

  it("falls back to mcp-local-<platform>-<arch> when no env vars set", () => {
    const id = deriveAgentIdentity(SAMPLE);
    expect(id.deploymentId).toBe(`mcp-local-${process.platform}-${process.arch}`);
  });

  it("respects custom orgId", () => {
    const id = deriveAgentIdentity({ ...SAMPLE, orgId: "test-org" });
    expect(id.orgId).toBe("test-org");
  });

  it("defaults maxEarnableTier to the observation-class max when omitted", () => {
    const id = deriveAgentIdentity({
      slug: "x",
      version: "0.1.0",
      name: "X",
      tier: 2,
      observationClass: "GRAY_BOX",
      capabilities: [],
    });
    // GRAY_BOX max earnable tier is 4; no explicit maxEarnableTier provided.
    expect(id.maxEarnableTier).toBe(4);
  });
});
