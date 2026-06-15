import { describe, it, expect } from "vitest";
import * as core from "../src/index.js";

describe("public API surface", () => {
  it("exports the proof-chain primitives", () => {
    expect(typeof core.ProofChain).toBe("function");
    expect(typeof core.hashText).toBe("function");
    expect(typeof core.hashJSON).toBe("function");
  });

  it("exports the car-identity primitives", () => {
    expect(typeof core.deriveAgentIdentity).toBe("function");
    expect(core.OBSERVATION_CEILING.BLACK_BOX).toBe(600);
    expect(core.OBSERVATION_MAX_TIER.BLACK_BOX).toBe(3);
    expect(core.TIER_NAME[3]).toBe("Monitored");
  });

  it("exports the canonical-json helpers", () => {
    expect(typeof core.canonicalJSON).toBe("function");
    expect(typeof core.sha256).toBe("function");
    expect(core.canonicalJSON({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it("does not leak the internal _resetKeyCacheForTests helper", () => {
    expect("_resetKeyCacheForTests" in core).toBe(false);
  });
});
