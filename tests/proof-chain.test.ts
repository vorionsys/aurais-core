import { describe, it, expect, beforeEach } from "vitest";
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto";
import {
  ProofChain,
  hashText,
  hashJSON,
  _resetKeyCacheForTests,
} from "../src/proof-chain.js";
import { canonicalJSON } from "../src/canonical-json.js";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

beforeEach(() => {
  // Each test gets a fresh ephemeral keypair so order doesn't matter.
  delete process.env.AURAIS_SIGNING_KEY_PRIV;
  _resetKeyCacheForTests();
});

describe("ProofChain", () => {
  it("starts empty with empty tipHash", () => {
    const chain = new ProofChain();
    expect(chain.toJSON()).toEqual([]);
    expect(chain.tipHash()).toBe("");
  });

  it("appends an event with the expected shape", () => {
    const chain = new ProofChain();
    const evt = chain.append("session_started", { foo: "bar" });
    expect(evt.seq).toBe(0);
    expect(evt.action).toBe("session_started");
    expect(evt.payload).toEqual({ foo: "bar" });
    expect(evt.prev_hash).toBe("");
    expect(evt.pubkey).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(evt.key_id).toMatch(/^ed25519(-ephemeral)?:[0-9a-f]{12}$/);
    expect(evt.sig).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(typeof evt.ts).toBe("string");
    expect(() => new Date(evt.ts).toISOString()).not.toThrow();
  });

  it("chains prev_hash correctly across multiple events", () => {
    const chain = new ProofChain();
    const e0 = chain.append("session_started", { a: 1 });
    const e1 = chain.append("commentary_generated", { b: 2 });
    const e2 = chain.append("briefing_assembled", { c: 3 });

    expect(e0.prev_hash).toBe("");
    expect(e1.prev_hash).toBe(sha256Hex(canonicalJSON(e0)));
    expect(e2.prev_hash).toBe(sha256Hex(canonicalJSON(e1)));

    expect(e0.seq).toBe(0);
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
  });

  it("tipHash is sha256(canonicalJSON(lastEvent))", () => {
    const chain = new ProofChain();
    chain.append("session_started", { a: 1 });
    const last = chain.append("briefing_assembled", { b: 2 });
    expect(chain.tipHash()).toBe(sha256Hex(canonicalJSON(last)));
  });

  it("produces a signature that verifies against the embedded pubkey", () => {
    const chain = new ProofChain();
    const evt = chain.append("session_started", { hello: "world" });

    // Reproduce exactly what proof-chain.ts signs: everything except `sig`.
    // Note that the signed object DOES include `pubkey` and `key_id` —
    // that's what binds the signer identity to the message.
    const { sig, ...unsigned } = evt;
    const toSign = Buffer.from(canonicalJSON(unsigned));
    const pubKey = createPublicKey({
      key: Buffer.from(evt.pubkey, "base64"),
      format: "der",
      type: "spki",
    });
    const ok = cryptoVerify(null, toSign, pubKey, Buffer.from(sig, "base64"));
    expect(ok).toBe(true);
  });

  it("toJSON returns a stable snapshot of all events", () => {
    const chain = new ProofChain();
    chain.append("session_started", {});
    chain.append("commentary_generated", {});
    expect(chain.toJSON().length).toBe(2);
    expect(chain.toJSON().map((e) => e.action)).toEqual([
      "session_started",
      "commentary_generated",
    ]);
  });
});

describe("hashText / hashJSON", () => {
  it("hashText prefixes 'sha256:' and matches sha256 of input string", () => {
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(hashText("abc")).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashJSON normalizes to canonical form before hashing", () => {
    const a = hashJSON({ x: 1, y: 2 });
    const b = hashJSON({ y: 2, x: 1 });
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
  });
});
