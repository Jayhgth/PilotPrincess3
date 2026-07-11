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

const transcriptCourseSchema = z.object({
  course_name: z.string().min(1).max(180),
  course_code: z.string().max(40).nullable(),
  subject: z.string().max(100).nullable(),
  grade_level: z.number().int().min(9).max(12).nullable(),
  school_year: z.string().max(20).nullable(),
  term: z.enum(["fall", "spring", "summer", "full_year"]),
  letter_grade: z.string().max(12).nullable(),
  credits: z.number().min(0).max(100).nullable(),
  weighted: z.boolean().nullable(),
  institution_name: z.string().max(180).nullable(),
  college_units: z.number().min(0).max(30).nullable(),
  confidence: confidenceSchema,
  evidence: z.string().max(600)
});

export const parsedTranscriptSchema = z.object({
  summary: z.string().min(1).max(1200),
  student_name: z.string().max(180).nullable(),
  school_name: z.string().max(180).nullable(),
  academic_years: z.array(z.string().max(20)).max(8),
  courses: z.array(transcriptCourseSchema).max(160),
  conflicts: z.array(z.string().max(600)).max(30),
  counselor_questions: z.array(z.string().max(300)).max(20)
});

export type ParsedTranscriptResult = z.infer<typeof parsedTranscriptSchema>;

export const parsedTranscriptJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "student_name", "school_name", "academic_years", "courses", "conflicts", "counselor_questions"],
  properties: {
    summary: { type: "string" },
    student_name: { type: ["string", "null"] },
    school_name: { type: ["string", "null"] },
    academic_years: { type: "array", items: { type: "string" } },
    courses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["course_name", "course_code", "subject", "grade_level", "school_year", "term", "letter_grade", "credits", "weighted", "institution_name", "college_units", "confidence", "evidence"],
        properties: {
          course_name: { type: "string" },
          course_code: { type: ["string", "null"] },
          subject: { type: ["string", "null"] },
          grade_level: { type: ["integer", "null"] },
          school_year: { type: ["string", "null"] },
          term: { type: "string", enum: ["fall", "spring", "summer", "full_year"] },
          letter_grade: { type: ["string", "null"] },
          credits: { type: ["number", "null"] },
          weighted: { type: ["boolean", "null"] },
          institution_name: { type: ["string", "null"] },
          college_units: { type: ["number", "null"] },
          confidence: { type: "string", enum: ["verified", "likely", "uncertain"] },
          evidence: { type: "string" }
        }
      }
    },
    conflicts: { type: "array", items: { type: "string" } },
    counselor_questions: { type: "array", items: { type: "string" } }
  }
} as const;

export const planningReviewSchema = z.object({
  answer: z.string().min(1).max(420),
  observations: z.array(z.object({
    label: z.string().min(1).max(90),
    detail: z.string().min(1).max(260),
    kind: z.enum(["attention", "consider", "clear"]),
    evidence: z.string().min(1).max(220)
  })).max(3),
  next_action: z.object({
    label: z.string().min(1).max(120),
    destination: z.enum(["courses", "graduation", "gpa", "activities", "timeline", "simulator", "profile"]),
    why: z.string().min(1).max(240)
  }).nullable(),
  verification_note: z.string().min(1).max(300)
});

export type PlanningReviewResult = z.infer<typeof planningReviewSchema>;

export const planningReviewJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "observations", "next_action", "verification_note"],
  properties: {
    answer: { type: "string" },
    observations: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "detail", "kind", "evidence"],
        properties: {
          label: { type: "string" },
          detail: { type: "string" },
          kind: { type: "string", enum: ["attention", "consider", "clear"] },
          evidence: { type: "string" }
        }
      }
    },
    next_action: {
      anyOf: [{ type: "null" }, {
        type: "object",
        additionalProperties: false,
        required: ["label", "destination", "why"],
        properties: {
          label: { type: "string" },
          destination: { type: "string", enum: ["courses", "graduation", "gpa", "activities", "timeline", "simulator", "profile"] },
          why: { type: "string" }
        }
      }]
    },
    verification_note: { type: "string" }
  }
} as const;
