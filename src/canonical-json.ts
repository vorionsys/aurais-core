/**
 * Canonical JSON serializer + sha256 helper.
 *
 * Canonical JSON: keys sorted, no whitespace. Used as the input for both
 * hashing and signing so independent verifiers can reproduce the digest
 * byte-for-byte regardless of object key insertion order.
 *
 * This is intentionally tiny and dependency-free (node:crypto only).
 * Both proof-chain and car-identity use it; extracted to avoid the
 * within-package duplication that the source files carried before
 * consolidation.
 */

import { createHash } from "node:crypto";

export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k]));
  return "{" + parts.join(",") + "}";
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
