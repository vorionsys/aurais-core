/**
 * Proof chain — signed + hash-chained event log for bot actions.
 *
 * Every event in a session carries:
 *  - timestamp (ISO)
 *  - action    (short machine-readable code)
 *  - payload   (action-specific data)
 *  - prev_hash (sha-256 of the previous event's canonical JSON, or "")
 *  - signature (ed25519 over canonical JSON of everything above)
 *  - pubkey    (base64 SPKI of the signing key — for independent verification)
 *
 * Signing key lifecycle (v0):
 *  - If AURAIS_SIGNING_KEY_PRIV is set (base64 PKCS#8 DER), use it.
 *  - Otherwise generate a session-scoped keypair on first use. The keypair
 *    lives for the duration of the serverless / process instance (warm
 *    invocations reuse it). This is fine for the BYOK demo; production
 *    bots will load a managed key from a KMS-style secret store.
 *
 * Source: extracted unchanged from voriongit/aurais src/lib/proof-chain.ts
 * @ be55bf0fffc4254c4f77da03a99a272f5bb7cd5e on 2026-04-25.
 */

import {
  generateKeyPairSync,
  sign as cryptoSign,
  type KeyObject,
  createPrivateKey,
  createPublicKey,
} from "node:crypto";
import { canonicalJSON, sha256 } from "./canonical-json.js";

// ---------- key material ----------

type KeyPair = {
  priv: KeyObject;
  pub: KeyObject;
  pubB64: string;
  keyId: string; // short fingerprint prefix, for display
};

let cachedKeys: KeyPair | null = null;

function ed25519KeyPair(): KeyPair {
  if (cachedKeys) return cachedKeys;

  const envPriv = process.env.AURAIS_SIGNING_KEY_PRIV;
  if (envPriv) {
    try {
      // Ed25519 private keys in PKCS#8 DER, base64
      const der = Buffer.from(envPriv, "base64");
      const priv = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
      const pub = createPublicKey(priv);
      const pubB64 = pub.export({ format: "der", type: "spki" }).toString("base64");
      const keyId = "ed25519:" + sha256(pubB64).slice(0, 12);
      cachedKeys = { priv, pub, pubB64, keyId };
      return cachedKeys;
    } catch {
      // fall through to session-scoped generation if env var is malformed
    }
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pubB64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const keyId = "ed25519-ephemeral:" + sha256(pubB64).slice(0, 12);
  cachedKeys = { priv: privateKey, pub: publicKey, pubB64, keyId };
  return cachedKeys;
}

/**
 * Test/internal helper — drop the cached keypair so the next ProofChain
 * picks up a fresh AURAIS_SIGNING_KEY_PRIV. Not exported from index.ts.
 */
export function _resetKeyCacheForTests(): void {
  cachedKeys = null;
}

// ---------- events ----------

/**
 * The event-action vocabulary used today across the Aurais Next app and the
 * five aurais-mcp-* packages. Keeping the union frozen for step 1 to avoid
 * breaking any consumer; widening / per-bot vocabularies will land in step 2.
 */
export type EventAction =
  | "session_started"
  | "market_data_fetched"
  | "indicators_computed"
  | "commentary_generated"
  | "briefing_assembled";

export type ProofEvent = {
  seq: number;
  ts: string; // ISO
  action: EventAction;
  payload: Record<string, unknown>;
  prev_hash: string; // "" for seq=0
  pubkey: string; // base64 SPKI of the signer
  key_id: string; // short fingerprint
  sig: string; // base64 Ed25519 signature over canonical JSON of the above
};

export class ProofChain {
  private events: ProofEvent[] = [];
  private keys: KeyPair;

  constructor() {
    this.keys = ed25519KeyPair();
  }

  append(action: EventAction, payload: Record<string, unknown>): ProofEvent {
    const seq = this.events.length;
    const prev_hash = seq === 0 ? "" : sha256(canonicalJSON(this.events[seq - 1]));
    const ts = new Date().toISOString();

    const unsigned = {
      seq,
      ts,
      action,
      payload,
      prev_hash,
      pubkey: this.keys.pubB64,
      key_id: this.keys.keyId,
    };
    const toSign = Buffer.from(canonicalJSON(unsigned));
    const sig = cryptoSign(null, toSign, this.keys.priv).toString("base64");

    const event: ProofEvent = { ...unsigned, sig };
    this.events.push(event);
    return event;
  }

  toJSON(): ProofEvent[] {
    return this.events;
  }

  /** Sha-256 of the canonical last event — the "tip" of the chain. */
  tipHash(): string {
    if (this.events.length === 0) return "";
    return sha256(canonicalJSON(this.events[this.events.length - 1]));
  }
}

// ---------- payload hashers (keep payloads small; commit to full content via hash) ----------

export function hashText(s: string): string {
  return "sha256:" + sha256(s);
}

export function hashJSON(v: unknown): string {
  return "sha256:" + sha256(canonicalJSON(v));
}
