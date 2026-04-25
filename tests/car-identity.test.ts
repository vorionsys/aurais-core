import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  deriveAgentIdentity,
  TIER_CEILING,
  TIER_NAME,
  type DeriveInput,
} from "../src/car-identity.js";

const SAMPLE: DeriveInput = {
  slug: "aurais-test-bot",
  version: "0.1.0",
  name: "Test Bot",
  tier: 3,
  maxEarnableTier: 4,
  capabilities: ["tool:read", "data:read:public"],
};

describe("TIER_CEILING and TIER_NAME", () => {
  it("matches canonical.ts ceilings", () => {
    expect(TIER_CEILING[0]).toBe(200);
    expect(TIER_CEILING[3]).toBe(600); // BLACK_BOX
    expect(TIER_CEILING[4]).toBe(750); // GRAY_BOX
    expect(TIER_CEILING[5]).toBe(900); // WHITE_BOX
    expect(TIER_CEILING[6]).toBe(950); // ATTESTED_BOX
    expect(TIER_CEILING[7]).toBe(1000); // VERIFIED_BOX
  });

  it("has consistent tier names", () => {
    expect(TIER_NAME[0]).toBe("PROVISIONING");
    expect(TIER_NAME[3]).toBe("BLACK_BOX");
    expect(TIER_NAME[7]).toBe("VERIFIED_BOX");
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
    expect(id.trustCeiling).toBe(600);
    expect(id.startingTier).toBe(0);
    expect(id.maxEarnableTier).toBe(4);
    expect(id.currentTier).toBe(3);
    expect(id.capabilities).toEqual(["tool:read", "data:read:public"]);
    expect(id.registrationStatus).toBe("offline-attested");
  });

  it("produces a stable carId for the same input", () => {
    const a = deriveAgentIdentity(SAMPLE);
    const b = deriveAgentIdentity(SAMPLE);
    expect(a.carId).toBe(b.carId);
    expect(a.contextHash).toBe(b.contextHash);
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

  it("defaults maxEarnableTier to current tier when omitted", () => {
    const id = deriveAgentIdentity({
      slug: "x",
      version: "0.1.0",
      name: "X",
      tier: 2,
      capabilities: [],
    });
    expect(id.maxEarnableTier).toBe(2);
  });
});
