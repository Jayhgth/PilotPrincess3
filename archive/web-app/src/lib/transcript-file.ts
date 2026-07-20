const TRANSCRIPT_MIME_TYPES: Record<string, string> = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  text: "text/plain",
  txt: "text/plain",
  webp: "image/webp"
};

const MIME_ALIASES: Record<string, string> = {
  "application/x-pdf": "application/pdf",
  "image/jpg": "image/jpeg"
};

const SUPPORTED_TRANSCRIPT_MIME_TYPES = new Set(Object.values(TRANSCRIPT_MIME_TYPES));

export function transcriptMimeType(reportedType: string | null | undefined, fileName: string) {
  const normalized = reportedType?.trim().toLowerCase() ?? "";
  const aliased = MIME_ALIASES[normalized] ?? normalized;
  if (SUPPORTED_TRANSCRIPT_MIME_TYPES.has(aliased)) return aliased;

  const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
  return TRANSCRIPT_MIME_TYPES[extension] ?? (aliased || "application/octet-stream");
}
