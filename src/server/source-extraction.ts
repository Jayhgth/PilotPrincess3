import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UserInput } from "@openai/codex-sdk";

const MAX_TEXT_CHARACTERS = 180_000;

export interface ExtractedSource {
  text: string;
  layoutText?: string;
  attachments: UserInput[];
  extractionNote: string;
}

interface PdfTextItem {
  str?: unknown;
  transform?: number[];
}

interface PdfPageReader {
  getViewport(options: { scale: number }): { convertToViewportPoint(x: number, y: number): [number, number] };
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  cleanup(): void;
}

interface PdfDocumentReader {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageReader>;
}

async function extractPositionedPdfText(parser: PDFParse) {
  const document = await (parser as unknown as { load(): Promise<PdfDocumentReader> }).load();
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const lines: Array<{ y: number; items: Array<{ x: number; text: string }> }> = [];

    for (const item of content.items) {
      if (typeof item.str !== "string" || !item.str.trim() || !item.transform) continue;
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
      let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
      if (!line) {
        line = { y, items: [] };
        lines.push(line);
      }
      line.items.push({ x, text: item.str.trim() });
    }

    lines.sort((left, right) => left.y - right.y);
    const pageMinX = Math.min(...lines.flatMap((line) => line.items.map((item) => item.x)));
    pages.push(lines.map((line) => {
      let value = "";
      for (const item of line.items.sort((left, right) => left.x - right.x)) {
        const column = Math.max(0, Math.round((item.x - pageMinX) / 4));
        value += column > value.length ? " ".repeat(column - value.length) : value ? " " : "";
        value += item.text;
      }
      return value.trimEnd();
    }).join("\n"));
    page.cleanup();
  }

  return boundedText(pages.join("\n"));
}

function boundedText(text: string) {
  return text.split(String.fromCharCode(0)).join("").trim().slice(0, MAX_TEXT_CHARACTERS);
}

export async function extractSource(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  scratchDirectory: string,
  options: { preserveTableLayout?: boolean } = {}
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
          layoutText: options.preserveTableLayout ? await extractPositionedPdfText(parser) : undefined,
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
