import { describe, expect, it } from "vitest";
import { CODEX_FEATURES, codexRuntimeStatus } from "@/server/codex";

describe("Codex feature boundaries", () => {
  it("keeps transcript text parsing and planning math deterministic", () => {
    const featureMap = Object.fromEntries(CODEX_FEATURES.map((feature) => [feature.id, feature.usesCodex]));
    const status = codexRuntimeStatus();

    expect(featureMap.structured_transcripts).toBe(false);
    expect(featureMap.planning_math).toBe(false);
    expect(featureMap.image_transcript_ocr).toBe(true);
    expect(status.features).toEqual(CODEX_FEATURES);
    expect(status.maxConcurrentTurns).toBe(2);
  });
});
