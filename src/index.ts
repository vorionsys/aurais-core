/**
 * @vorionsys/aurais-core — shared library for the Aurais ecosystem.
 *
 * Public API surface:
 *  - Proof chain: ProofChain class, ProofEvent / EventAction types,
 *    hashText / hashJSON helpers
 *  - CAR identity: deriveAgentIdentity, AgentIdentity / DeriveInput / TrustTier
 *    types, TIER_CEILING / TIER_NAME tables
 *  - Canonical JSON: canonicalJSON serializer + sha256 helper (re-exported
 *    so callers can produce digests that match what the lib produces)
 *
 * Source: extracted from voriongit/aurais src/lib/{proof-chain,car-identity}.ts
 * @ be55bf0fffc4254c4f77da03a99a272f5bb7cd5e — see README.md.
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
  TIER_CEILING,
  TIER_NAME,
} from "./car-identity.js";

export { canonicalJSON, sha256 } from "./canonical-json.js";
