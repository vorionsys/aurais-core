# @vorionsys/aurais-core

Shared library for the Aurais ecosystem. Provides:

- **`ProofChain`** — Ed25519-signed, sha256-chained event log for bot actions
- **`deriveAgentIdentity`** — offline CAR-shaped identity derivation (deterministic ID, contextHash, tier ceiling)
- **`canonicalJSON` / `sha256`** — the canonical-JSON serializer + hash used by both, exported for callers that need to reproduce digests

License: Apache-2.0.

---

## Why this exists

The Aurais Next app and the five `aurais-mcp-*` packages each carried their
own copy of `proof-chain.ts` and `car-identity.ts`. The `proof-chain.ts`
copies were byte-identical across all five MCPs (sha256
`e17631fd…` × 5); the `car-identity.ts` copies differed only in the per-bot
`*_IDENTITY` constant pinned to the bottom. The MCP source headers said,
verbatim:

> Copied from apps/aurais/src/lib/proof-chain.ts for this standalone package.
> Future: extract to **@aurais/core** and have both packages import.

This is that extract.

We chose the npm name `@vorionsys/aurais-core` rather than `@aurais/core`
for scope continuity with the rest of the Vorion org packages
(`@vorionsys/basis-gate-spec`, `@vorionsys/car-client`, etc.) — registering
a fresh `@aurais` scope is admin friction we can defer. Renaming later if
the marketing surface ever requires it is a one-pass change.

## Three-step consolidation — this is step 1

1. **Step 1 (this repo):** extract the canonical lib into a standalone
   package with tests + CI.
2. **Step 2:** update downstream Aurais consumers to pull from
   `@vorionsys/aurais-core` instead of their local copies. Per-bot
   `*_IDENTITY` constants stay in each consumer — they're per-bot config,
   not shared.
3. **Step 3:** land the MCP packages in their final homes.

## Install

```bash
npm install @vorionsys/aurais-core
```

Requires Node 22+.

## Usage

### Proof chain

```ts
import { ProofChain, hashText } from "@vorionsys/aurais-core";

const chain = new ProofChain();

const entry = "User wrote a journal entry…";
chain.append("session_started", {
  bot: "aurais-journal-companion@0.1.0",
  entry_hash: hashText(entry),
});

chain.append("commentary_generated", {
  model: "claude-sonnet-4-5",
  elapsed_ms: 423,
});

const events = chain.toJSON();      // ProofEvent[]
const tip = chain.tipHash();        // sha256 of the last canonical event
```

Each event embeds the signer's pubkey (base64 SPKI) and the Ed25519
signature, so any consumer can verify chain integrity offline:

```ts
import { createPublicKey, verify } from "node:crypto";
import { canonicalJSON } from "@vorionsys/aurais-core";

const evt = events[0];
// The signed object is everything in the event except `sig`.
// `pubkey` and `key_id` are part of what's signed — that binds the
// signer identity to the message.
const { sig, ...unsigned } = evt;
const ok = verify(
  null,
  Buffer.from(canonicalJSON(unsigned)),
  createPublicKey({ key: Buffer.from(evt.pubkey, "base64"), format: "der", type: "spki" }),
  Buffer.from(sig, "base64"),
);
```

### CAR identity

```ts
import { deriveAgentIdentity } from "@vorionsys/aurais-core";

const id = deriveAgentIdentity({
  slug: "aurais-journal-companion",
  version: "0.1.0",
  name: "Aurais Journal Companion",
  tier: 3,
  maxEarnableTier: 4,
  capabilities: [
    "tool:analyze_journal_entry",
    "tool:generate_reflection",
    "data:read:user:journal-entry-transient",
    "api:post:api.anthropic.com",
    "runtime:mcp-stdio",
  ],
});

console.log(id.carId);            // car-aurais-journal-companion-<12 hex>
console.log(id.contextHash);      // sha256:<64 hex>
console.log(id.trustCeiling);     // 600 (BLACK_BOX)
console.log(id.deploymentId);     // resolved from env vars (see below)
```

### Signing key resolution

`ProofChain` looks for `AURAIS_SIGNING_KEY_PRIV` (base64 PKCS#8 DER of an
Ed25519 private key). If unset (or malformed), it generates an ephemeral
keypair scoped to the current process. The keypair is cached process-wide,
so warm serverless invocations reuse the same signer.

### Deployment ID resolution

`deriveAgentIdentity` resolves `deploymentId` in this order:

1. `AURAIS_DEPLOYMENT_ID` — explicit override (typical for MCP test/CI runs)
2. `VERCEL_DEPLOYMENT_ID` — set by Vercel for the Next app
3. `VERCEL_GIT_COMMIT_SHA` — first 12 chars
4. `mcp-local-${process.platform}-${process.arch}` — local-dev fallback
5. `"local-dev"` — last resort

This intentionally unions both consumers' resolution rules so neither
consumer changes behavior at step-2 fold-in.

## API

```ts
// Proof chain
class ProofChain {
  constructor();
  append(action: EventAction, payload: Record<string, unknown>): ProofEvent;
  toJSON(): ProofEvent[];
  tipHash(): string;
}
type EventAction =
  | "session_started"
  | "market_data_fetched"
  | "indicators_computed"
  | "commentary_generated"
  | "briefing_assembled";
type ProofEvent = {
  seq: number;
  ts: string;
  action: EventAction;
  payload: Record<string, unknown>;
  prev_hash: string;
  pubkey: string;
  key_id: string;
  sig: string;
};
function hashText(s: string): string;            // → "sha256:<64 hex>"
function hashJSON(v: unknown): string;           // → "sha256:<64 hex>"

// CAR identity
function deriveAgentIdentity(input: DeriveInput): AgentIdentity;
const TIER_CEILING: Record<TrustTier, number>;   // canonical.ts ceilings
const TIER_NAME: Record<TrustTier, string>;
type TrustTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

// Canonical JSON
function canonicalJSON(value: unknown): string;  // sorted-keys, no whitespace
function sha256(text: string): string;           // hex
```

## Known follow-ups (step 2 / step 3)

- **`EventAction` union is hardcoded** to the original five actions
  (`session_started`, `market_data_fetched`, `indicators_computed`,
  `commentary_generated`, `briefing_assembled`). The Meeting Distiller and
  Journal Companion MCPs currently reuse `briefing_assembled` for what's
  semantically a meeting summary or a reflection. Step 2 should decide
  whether to widen the union, switch to a `string` typedef, or introduce a
  per-bot extension point.
- **`AgentIdentity` shape matches the offline CAR spec** (the live
  `@vorionsys/car-client` registers against the AgentAnchor backend); when
  that backend lands the lib should grow a `registerAgent()` shim that
  flips `registrationStatus` from `offline-attested` to `registered`.
- **The test suite here is the first one for these files.** Step-2 fold-in
  should add an integration test in each consumer that exercises a
  round-trip-and-verify against this lib.

## Repo

[github.com/vorionsys/aurais-core](https://github.com/vorionsys/aurais-core)
