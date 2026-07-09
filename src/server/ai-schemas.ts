import { z } from "zod";

const confidenceSchema = z.enum(["verified", "likely", "uncertain"]);

export const parsedSourceSchema = z.object({
  summary: z.string().min(1).max(1200),
  courses: z.array(
    z.object({
      name: z.string().min(1).max(180),
      subject: z.string().max(100),
      grade_levels: z.array(z.number().int().min(9).max(12)).max(4),
      credits: z.number().min(0).max(100).nullable(),
      term_type: z.enum(["semester", "year", "variable"]),
      prerequisites: z.array(z.string().max(160)).max(12),
      requirement_category: z.string().max(100).nullable(),
      weighted: z.boolean().nullable(),
      description: z.string().max(1500).nullable(),
      confidence: confidenceSchema,
      evidence: z.string().max(600)
    })
  ).max(120),
  requirements: z.array(
    z.object({
      name: z.string().min(1).max(180),
      category: z.string().max(100),
      credits_required: z.number().min(0).max(500).nullable(),
      years_required: z.number().min(0).max(8).nullable(),
      notes: z.string().max(1200).nullable(),
      confidence: confidenceSchema,
      evidence: z.string().max(600)
    })
  ).max(40),
  policies: z.array(
    z.object({
      title: z.string().min(1).max(180),
      details: z.string().max(1500),
      confidence: confidenceSchema,
      evidence: z.string().max(600)
    })
  ).max(40),
  conflicts: z.array(z.string().max(600)).max(30),
  counselor_questions: z.array(z.string().max(300)).max(20)
});

export type ParsedSourceResult = z.infer<typeof parsedSourceSchema>;

export const parsedSourceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "courses", "requirements", "policies", "conflicts", "counselor_questions"],
  properties: {
    summary: { type: "string" },
    courses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "subject", "grade_levels", "credits", "term_type", "prerequisites", "requirement_category", "weighted", "description", "confidence", "evidence"],
        properties: {
          name: { type: "string" },
          subject: { type: "string" },
          grade_levels: { type: "array", items: { type: "integer" } },
          credits: { type: ["number", "null"] },
          term_type: { type: "string", enum: ["semester", "year", "variable"] },
          prerequisites: { type: "array", items: { type: "string" } },
          requirement_category: { type: ["string", "null"] },
          weighted: { type: ["boolean", "null"] },
          description: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["verified", "likely", "uncertain"] },
          evidence: { type: "string" }
        }
      }
    },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "category", "credits_required", "years_required", "notes", "confidence", "evidence"],
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          credits_required: { type: ["number", "null"] },
          years_required: { type: ["number", "null"] },
          notes: { type: ["string", "null"] },
          confidence: { type: "string", enum: ["verified", "likely", "uncertain"] },
          evidence: { type: "string" }
        }
      }
    },
    policies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "details", "confidence", "evidence"],
        properties: {
          title: { type: "string" },
          details: { type: "string" },
          confidence: { type: "string", enum: ["verified", "likely", "uncertain"] },
          evidence: { type: "string" }
        }
      }
    },
    conflicts: { type: "array", items: { type: "string" } },
    counselor_questions: { type: "array", items: { type: "string" } }
  }
} as const;

export const explanationSchema = z.object({
  summary: z.string().min(1).max(1600),
  what_changed: z.array(z.string().max(400)).max(12),
  tradeoffs: z.array(z.string().max(500)).max(12),
  risks: z.array(z.string().max(500)).max(12),
  counselor_questions: z.array(z.string().max(300)).max(10)
});

export type ExplanationResult = z.infer<typeof explanationSchema>;

export const explanationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "what_changed", "tradeoffs", "risks", "counselor_questions"],
  properties: {
    summary: { type: "string" },
    what_changed: { type: "array", items: { type: "string" } },
    tradeoffs: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    counselor_questions: { type: "array", items: { type: "string" } }
  }
} as const;

export const summarySchema = z.object({
  summary: z.string().min(1).max(1400)
});

export const summaryJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: { summary: { type: "string" } }
} as const;
