export function normalizeCourseName(value: string) {
  const designLabTranscriptLabel = /^\s*d\s*\.?\s*lab\s*:\s*/i.test(value);
  const normalized = value
    .toLowerCase()
    .replace(/^\s*d\s*\.?\s*lab\s*:\s*/i, "")
    .replace(/\bhonors?\b/g, designLabTranscriptLabel ? "" : "honors")
    .replace(/\badvanced placement\b/g, "ap")
    .replace(/\bintro\b/g, "introduction")
    .replace(/\bcodesigners\b/g, "co designers")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\bpre\s+calculus\b/g, "precalculus")
    .trim();

  return normalized === "foundation design thinking"
    ? "foundation in design thinking"
    : normalized;
}

export function courseNameAliases(value: string) {
  return value
    .split("/")
    .map(normalizeCourseName)
    .filter(Boolean);
}

export function courseEquivalenceKeys(value: string) {
  const keys = new Set<string>();
  for (const alias of courseNameAliases(value)) {
    keys.add(alias);
    const withoutHonors = alias.replace(/\s+honors\b/g, "").replace(/\s+/g, " ").trim();
    if (withoutHonors) keys.add(withoutHonors);
  }
  return keys;
}
