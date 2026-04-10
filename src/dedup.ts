import type { VaultEntry } from "./types.js";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F]+/g, " ").trim();
}

/**
 * Check if `candidate` is too similar to any existing vault entry.
 * Compares the first 100 normalized chars — entries that share
 * the same prefix are considered duplicates.
 */
export function isDuplicate(
  candidate: string,
  existing: readonly VaultEntry[],
  prefixLen = 100,
): boolean {
  const normCandidate = normalize(candidate).slice(0, prefixLen);
  if (normCandidate.length < 20) return false;

  for (const entry of existing) {
    const normExisting = normalize(entry.content).slice(0, prefixLen);
    if (normExisting === normCandidate) return true;
  }
  return false;
}
