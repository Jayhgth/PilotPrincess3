import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UserInput } from "@openai/codex-sdk";

const MAX_TEXT_CHARACTERS = 180_000;

export interface ExtractedSource {
  text: string;
  attachments: UserInput[];
  extractionNote: string;
}

function boundedText(text: string) {
  return text.split(String.fromCharCode(0)).join("").trim().slice(0, MAX_TEXT_CHARACTERS);
}

export async function extractSource(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  scratchDirectory: string
): Promise<ExtractedSource> {
  if (mimeType === "text/plain" || mimeType === "text/csv") {
    return {
      text: boundedText(buffer.toString("utf8")),
      attachments: [],
      extractionNote: "Text decoded directly from the uploaded file."
    };
  }

  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return {
      text: boundedText(result.value),
      attachments: [],
      extractionNote: result.messages.length > 0 ? "DOCX text extracted with conversion warnings." : "DOCX text extracted."
    };
  }

  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const text = boundedText(result.text);
      if (text.length >= 80) {
        return {
          text,
          attachments: [],
          extractionNote: `PDF text extracted from ${result.total} page(s).`
        };
      }
      const screenshots = await parser.getScreenshot({ first: Math.min(result.total, 4), desiredWidth: 1400 });
      const attachments: UserInput[] = [];
      for (const [index, page] of screenshots.pages.entries()) {
        const path = join(scratchDirectory, `pdf-page-${index + 1}.png`);
        await writeFile(path, page.data);
        attachments.push({ type: "local_image", path });
      }
      return {
        text,
        attachments,
        extractionNote: "The PDF had little embedded text, so up to four pages were attached as images for review."
      };
    } finally {
      await parser.destroy();
    }
  }

  if (["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
    const safeExtension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const path = join(scratchDirectory, `source-image.${safeExtension}`);
    await writeFile(path, buffer);
    return {
      text: "",
      attachments: [{ type: "local_image", path }],
      extractionNote: `${fileName} was attached as an image for structured review.`
    };
  }

  throw new Error(`Unsupported source type: ${mimeType}`);
}
