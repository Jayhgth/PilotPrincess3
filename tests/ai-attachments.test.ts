import { describe, expect, it } from "vitest";
import { assistantImageExtension, MAX_ASSISTANT_ATTACHMENTS, safeAssistantImageName, validateAssistantImage } from "@/lib/ai-attachments";

describe("assistant image boundaries", () => {
  it("accepts supported images within the private upload limit", () => {
    expect(validateAssistantImage({ name: "plan.png", type: "image/png", size: 1024 })).toBeNull();
    expect(MAX_ASSISTANT_ATTACHMENTS).toBe(8);
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(validateAssistantImage({ name: "plan.svg", type: "image/svg+xml", size: 1024 })).toContain("PNG");
    expect(validateAssistantImage({ name: "empty.jpg", type: "image/jpeg", size: 0 })).toContain("empty");
    expect(validateAssistantImage({ name: "large.webp", type: "image/webp", size: 10 * 1024 * 1024 + 1 })).toContain("10 MB");
  });

  it("normalizes storage names and extensions without trusting the upload name", () => {
    expect(safeAssistantImageName("../My schedule (final).PNG")).toBe("..-My-schedule-final-.PNG");
    expect(assistantImageExtension("image/webp")).toBe(".webp");
    expect(assistantImageExtension("image/jpeg")).toBe(".jpg");
  });
});
