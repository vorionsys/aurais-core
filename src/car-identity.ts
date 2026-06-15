/**
 * Offline CAR identity derivation.
 *
 * The full @vorionsys/car-client library is a registry-backed SDK that expects
 * a live backend (api.agentanchorai.com) for agent registration, role-gate
 * evaluation, ceiling checks, and tier progression. Aurais consumers (the
 * Next app + the aurais-mcp-* packages) don't have that backend stood up yet,
 * so they can't register bots live.
 *
 * What we CAN do offline:
 *   - Derive a deterministic CAR ID from (slug, version, manifest_hash) where
 *     the manifest binds the bot's tier, observation class, and capabilities
 *   - Generate a fresh operationId per run
 *   - Compute a contextHash over the bot's declared manifest fields
 *   - Emit these fields in the proof chain, shape-matching the CAR spec
 *
 * Trust model — two orthogonal axes (mirrors canonical.ts in
 * vorion/packages/basis/src/canonical.ts):
 *   - TRUST TIER (T0–T7): what an agent has *earned* through demonstrated
 *     behavior. Names in TIER_NAME.
 *   - OBSERVATION CLASS: how inspectable the agent is. This sets the trust
 *     score ceiling (OBSERVATION_CEILING) and the maximum earnable tier
 *     (OBSERVATION_MAX_TIER). "You cannot fully trust what you cannot fully
 *     inspect."
 *
 * The observation class is bound into the manifest digest, so a change of
 * class yields a different contextHash (and CAR ID).
 *
 * History: originally a tier-only model. Unified to the observation-class
 * model (the canonical split, already live in the Aurais Next app) so every
 * consumer derives identity the same way. See README.md.
 */

import { canonicalJSON, sha256 } from "./canonical-json.js";

export type TrustTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/**
 * TRUST tier names — what an agent has earned. Orthogonal to observation
 * class. Exact mirror of canonical TRUST_TIERS.
 */
export const TIER_NAME: Record<TrustTier, string> = {
  0: "Sandbox",
  1: "Observed",
  2: "Provisional",
  3: "Monitored",
  4: "Standard",
  5: "Trusted",
  6: "Certified",
  7: "Autonomous",
};

/**
 * OBSERVATION class — the axis that sets the trust-score ceiling. Mirrors
 * canonical OBSERVATION_TIERS. Distinct from the earned trust tier (T0–T7).
 */
export type ObservationClass =
  | "BLACK_BOX"
  | "GRAY_BOX"
  | "WHITE_BOX"
  | "ATTESTED_BOX"
  | "VERIFIED_BOX";

export const OBSERVATION_CEILING: Record<ObservationClass, number> = {
  BLACK_BOX: 600,
  GRAY_BOX: 750,
  WHITE_BOX: 900,
  ATTESTED_BOX: 950,
  VERIFIED_BOX: 1000,
};

export const OBSERVATION_MAX_TIER: Record<ObservationClass, TrustTier> = {
  BLACK_BOX: 3,
  GRAY_BOX: 4,
  WHITE_BOX: 6,
  ATTESTED_BOX: 6,
  VERIFIED_BOX: 7,
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
  /** Observation-class-derived trust-score ceiling. */
  trustCeiling: number;
  /** Observation class — the axis that sets the ceiling. */
  observationClass: ObservationClass;
  /** Starting tier — per spec, all bots begin at T0 until onboarding. */
  startingTier: TrustTier;
  /** Max tier this bot is approved to reach (clamped to the observation-class max). */
  maxEarnableTier: TrustTier;
  /** Tier this bot is currently operating at (for self-asserted bots, the required runtime tier). */
  currentTier: TrustTier;
  /** Capabilities declared in the manifest. */
  capabilities: string[];
  /** Status label for the UI — reflects that live registration is pending backend. */
  registrationStatus: "self-asserted" | "registered" | "pending";
};

export type DeriveInput = {
  slug: string;
  version: string;
  name: string;
  /** Current operating trust tier. */
  tier: TrustTier;
  /** Observation class — sets the ceiling and the maximum earnable tier. */
  observationClass: ObservationClass;
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
 *
 * Note: deploymentId is runtime context only — it is NOT part of the manifest
 * digest, so it never affects carId / contextHash.
 */
function resolveDeploymentId(): string {
  if (process.env.AURAIS_DEPLOYMENT_ID) return process.env.AURAIS_DEPLOYMENT_ID;
  if (process.env.VERCEL_DEPLOYMENT_ID) return process.env.VERCEL_DEPLOYMENT_ID;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (sha) return sha.slice(0, 12);
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

  // Canonical manifest digest (deterministic, version-pinned). observationClass
  // is bound in so a change of class produces a different contextHash / CAR ID.
  const manifestBlob = canonicalJSON({
    slug: input.slug,
    version: input.version,
    name: input.name,
    tier: input.tier,
    observationClass: input.observationClass,
    capabilities: [...input.capabilities].sort(),
    orgId,
  });
  const contextHash = "sha256:" + sha256(manifestBlob);

  // CAR ID shape: car-<slug>-<12 chars of context+org>
  const carHashShort = sha256(contextHash + orgId).slice(0, 12);
  const carId = `car-${input.slug}-${carHashShort}`;

  // Short agent ID (for logs, badges)
  const agentId = `${input.slug}@${input.version}`;

  // Fresh op ID per call
  const operationId = sha256(carId + Date.now() + Math.random()).slice(0, 16);

  // Ceiling and max earnable tier are functions of OBSERVATION class, not the
  // (earned) trust tier.
  const trustCeiling = OBSERVATION_CEILING[input.observationClass];
  const obsMax = OBSERVATION_MAX_TIER[input.observationClass];
  const maxEarnableTier = Math.min(input.maxEarnableTier ?? obsMax, obsMax) as TrustTier;

  return {
    carId,
    agentId,
    operationId,
    orgId,
    deploymentId,
    contextHash,
    parentHash: "", // root
    trustCeiling,
    observationClass: input.observationClass,
    startingTier: 0,
    maxEarnableTier,
    currentTier: input.tier,
    capabilities: input.capabilities,
    // Flip to "registered" once the backend lands and we call CARClient.registerAgent.
    registrationStatus: "self-asserted",
  };
}
