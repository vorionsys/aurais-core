import { describe, it, expect } from "vitest";
import { canonicalJSON, sha256 } from "../src/canonical-json.js";

describe("canonicalJSON", () => {
  it("serializes primitives like JSON.stringify", () => {
    expect(canonicalJSON(null)).toBe("null");
    expect(canonicalJSON(42)).toBe("42");
    expect(canonicalJSON("hi")).toBe('"hi"');
    expect(canonicalJSON(true)).toBe("true");
  });

  it("sorts object keys", () => {
    expect(canonicalJSON({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJSON({ z: 1, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"z":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJSON([3, 1, 2])).toBe("[3,1,2]");
  });

  it("handles arrays of objects with sorted inner keys", () => {
    expect(canonicalJSON([{ b: 1, a: 2 }, { d: 3, c: 4 }])).toBe(
      '[{"a":2,"b":1},{"c":4,"d":3}]',
    );
  });

  it("emits no whitespace", () => {
    const out = canonicalJSON({ a: 1, b: [2, 3], c: { d: 4 } });
    expect(out).toBe('{"a":1,"b":[2,3],"c":{"d":4}}');
    expect(out).not.toMatch(/\s/);
  });

  it("is deterministic across key insertion orders", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { z: 3, y: 2, x: 1 };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });
});

describe("sha256", () => {
  it("matches a known vector", () => {
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(sha256("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("produces 64 hex chars", () => {
    expect(sha256("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});
