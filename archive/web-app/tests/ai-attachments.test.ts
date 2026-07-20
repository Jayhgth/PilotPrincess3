import { describe, expect, it } from "vitest";
import { assistantImageExtension, MAX_ASSISTANT_ATTACHMENTS, safeAssistantImageName, validateAssistantImage } from "@/lib/ai-attachments";

describe("assistant image boundaries", () => {
  it("validates attachment safety and normalization", () => {
    {
    expect(validateAssistantImage({ name: "plan.png", type: "image/png", size: 1024 })).toBeNull();
    expect(MAX_ASSISTANT_ATTACHMENTS).toBe(8);
    }

    {
    expect(validateAssistantImage({ name: "plan.svg", type: "image/svg+xml", size: 1024 })).toContain("PNG");
    expect(validateAssistantImage({ name: "empty.jpg", type: "image/jpeg", size: 0 })).toContain("empty");
    expect(validateAssistantImage({ name: "large.webp", type: "image/webp", size: 10 * 1024 * 1024 + 1 })).toContain("10 MB");
    }

    {
    expect(safeAssistantImageName("../My schedule (final).PNG")).toBe("..-My-schedule-final-.PNG");
    expect(assistantImageExtension("image/webp")).toBe(".webp");
    expect(assistantImageExtension("image/jpeg")).toBe(".jpg");
    }
  });
});
