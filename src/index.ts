/**
 * @vorionsys/aurais-core — shared library for the Aurais ecosystem.
 *
 * Public API surface:
 *  - Proof chain: ProofChain class, ProofEvent / EventAction types,
 *    hashText / hashJSON helpers
 *  - CAR identity: deriveAgentIdentity, AgentIdentity / DeriveInput / TrustTier
 *    / ObservationClass types, TIER_NAME / OBSERVATION_CEILING /
 *    OBSERVATION_MAX_TIER tables
 *  - Canonical JSON: canonicalJSON serializer + sha256 helper (re-exported
 *    so callers can produce digests that match what the lib produces)
 *
 */

export {
  ProofChain,
  type ProofEvent,
  type EventAction,
  hashText,
  hashJSON,
} from "./proof-chain.js";

export {
  deriveAgentIdentity,
  type AgentIdentity,
  type DeriveInput,
  type TrustTier,
  type ObservationClass,
  TIER_NAME,
  OBSERVATION_CEILING,
  OBSERVATION_MAX_TIER,
} from "./car-identity.js";

export { canonicalJSON, sha256 } from "./canonical-json.js";
