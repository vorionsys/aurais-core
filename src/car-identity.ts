/**
 * Offline CAR identity derivation.
 *
 * The full @vorionsys/car-client library is a registry-backed SDK that expects
 * a live backend (api.agentanchorai.com) for agent registration, role-gate
 * evaluation, ceiling checks, and tier progression. Aurais consumers (the
 * Next app + the five aurais-mcp-* packages) don't have that backend stood
 * up yet, so they can't register bots live.
 *
 * What we CAN do offline:
 *   - Derive a deterministic CAR ID from (bot_slug, bot_version, manifest_hash)
 *   - Generate a fresh operationId per run
 *   - Compute a contextHash over the bot's declared capabilities + tier
 *   - Emit these fields in the proof chain, shape-matching the CAR spec
 *
 * When the backend lands, we add a registration step in the bot bootstrap
 * flow that submits this same agent context and gets a signed registration
 * record back. All the existing proof-chain events remain compatible.
 *
 * Source: extracted (with deploymentId resolver widened to cover both the
 * Next app's Vercel env and the MCPs' stdio env) from voriongit/aurais
 * src/lib/car-identity.ts @ be55bf0fffc4254c4f77da03a99a272f5bb7cd5e
 * on 2026-04-25.
 */

import { canonicalJSON, sha256 } from "./canonical-json.js";

export type TrustTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Observation ceilings per canonical.ts (packages/basis/src/canonical.ts).
export const TIER_CEILING: Record<TrustTier, number> = {
  0: 200,
  1: 300,
  2: 450,
  3: 600, // BLACK_BOX
  4: 750, // GRAY_BOX
  5: 900, // WHITE_BOX
  6: 950, // ATTESTED_BOX
  7: 1000, // VERIFIED_BOX
};

export const TIER_NAME: Record<TrustTier, string> = {
  0: "PROVISIONING",
  1: "INITIATED",
  2: "OBSERVED",
  3: "BLACK_BOX",
  4: "GRAY_BOX",
  5: "WHITE_BOX",
  6: "ATTESTED_BOX",
  7: "VERIFIED_BOX",
};

export type AgentIdentity = {
  /** CAR ID — deterministic, stable across runs of the same deployed version. */
  carId: string;
  /** Short human-readable: slug + short hash. */
  agentId: string;
  /** Per-run unique operation ID. */
  operationId: string;
  /** Org this agent is registered under. */
  orgId: string;
  /** Deployment identifier (Vercel env, AURAIS_DEPLOYMENT_ID, or local fallback). */
  deploymentId: string;
  /** sha256 of manifest-canonical fields. */
  contextHash: string;
  /** Parent registration hash. "" for root agents owned by Vorion LLC. */
  parentHash: string;
  /** Trust ceiling (score cap) this tier allows. */
  trustCeiling: number;
  /** Starting tier — per spec, all bots begin at T0 until onboarding. */
  startingTier: TrustTier;
  /** Max tier this bot is approved to reach. */
  maxEarnableTier: TrustTier;
  /** Tier this bot is currently operating at (for offline-attested bots, the required runtime tier). */
  currentTier: TrustTier;
  /** Capabilities declared in the manifest. */
  capabilities: string[];
  /** Status label for the UI — reflects that live registration is pending backend. */
  registrationStatus: "offline-attested" | "registered" | "pending";
};

export type DeriveInput = {
  slug: string;
  version: string;
  name: string;
  tier: TrustTier;
  maxEarnableTier?: TrustTier;
  capabilities: string[];
  orgId?: string;
};

/**
 * Resolve the deployment ID across both Vercel-hosted (Next app) and
 * stdio-hosted (MCP servers) environments. Priority:
 *   1. AURAIS_DEPLOYMENT_ID  — explicit override (used by MCPs in CI/tests)
 *   2. VERCEL_DEPLOYMENT_ID  — set by Vercel for the Next app
 *   3. VERCEL_GIT_COMMIT_SHA — Vercel commit SHA, first 12 chars
 *   4. mcp-local-${platform}-${arch} — MCP local-dev fallback
 *   5. "local-dev" — last-resort
 */
function resolveDeploymentId(): string {
  if (process.env.AURAIS_DEPLOYMENT_ID) return process.env.AURAIS_DEPLOYMENT_ID;
  if (process.env.VERCEL_DEPLOYMENT_ID) return process.env.VERCEL_DEPLOYMENT_ID;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 12);
  // Process is always available in Node — both Vercel functions and stdio MCPs.
  if (process.platform && process.arch) {
    return `mcp-local-${process.platform}-${process.arch}`;
  }
  return "local-dev";
}

/**
 * Derive a deterministic CAR ID for a bot deployment.
 * Safe to call on every request — same inputs → same ID.
 */
export function deriveAgentIdentity(input: DeriveInput): AgentIdentity {
  const orgId = input.orgId ?? "vorion-llc";
  const deploymentId = resolveDeploymentId();

  // Canonical manifest digest (deterministic, version-pinned)
  const manifestBlob = canonicalJSON({
    slug: input.slug,
    version: input.version,
    name: input.name,
    tier: input.tier,
    capabilities: [...input.capabilities].sort(),
    orgId,
  });
  const contextHash = "sha256:" + sha256(manifestBlob);

  // CAR ID shape: car-<slug>-<12chars of context+org>
  const carHashShort = sha256(contextHash + orgId).slice(0, 12);
  const carId = `car-${input.slug}-${carHashShort}`;

  // Short agent ID (for logs, badges)
  const agentId = `${input.slug}@${input.version}`;

  // Fresh op ID per call
  const operationId = sha256(carId + Date.now() + Math.random()).slice(0, 16);

  const trustCeiling = TIER_CEILING[input.tier];
  const maxEarnableTier = input.maxEarnableTier ?? input.tier;

  return {
    carId,
    agentId,
    operationId,
    orgId,
    deploymentId,
    contextHash,
    parentHash: "", // root
    trustCeiling,
    startingTier: 0,
    maxEarnableTier,
    currentTier: input.tier,
    capabilities: input.capabilities,
    // Flip to "registered" once the backend lands and we call CARClient.registerAgent.
    registrationStatus: "offline-attested",
  };
}
