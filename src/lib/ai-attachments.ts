export const MAX_ASSISTANT_ATTACHMENTS = 8;
export const MAX_ASSISTANT_IMAGE_BYTES = 10 * 1024 * 1024;

export const ASSISTANT_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

export type AssistantImageMimeType = (typeof ASSISTANT_IMAGE_MIME_TYPES)[number];

export interface AssistantImageCandidate {
  name: string;
  type: string;
  size: number;
}

export function validateAssistantImage(candidate: AssistantImageCandidate) {
  if (!ASSISTANT_IMAGE_MIME_TYPES.includes(candidate.type as AssistantImageMimeType)) {
    return "Use a PNG, JPEG, or WebP image.";
  }
  if (candidate.size <= 0) return "That image is empty.";
  if (candidate.size > MAX_ASSISTANT_IMAGE_BYTES) return "Each image must be 10 MB or smaller.";
  return null;
}

export function safeAssistantImageName(name: string) {
  const cleaned = name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
  return cleaned || "image";
}

export function assistantImageExtension(mimeType: string) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}
