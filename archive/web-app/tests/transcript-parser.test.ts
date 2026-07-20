import { describe, expect, it } from "vitest";
import { findTranscriptCatalogMatch, inferTranscriptGradeLevel } from "@/lib/transcript";
import type { Course } from "@/lib/models";
import { parseDtechTranscriptText, parseSmccdTranscriptText, TRANSCRIPT_PARSER_VERSION } from "@/server/transcript-parser";
import { transcriptMimeType } from "@/lib/transcript-file";

const TRANSCRIPT_TEXT = `
GR Course S0 CR S1 CR S2 CR GR Course S0 CR S1 CR S2 CR
25-26 College of San Mateo
11 * CIS 127 HTML5 and CSS A 5.0
25-26 Design Tech High School
11 * Advanced Physics Honors A 5.0 A 5.0
11 Q1 Internship/TA (Teacher's Assistant) P 2.5
24-25 Skyline College
10 * CIS 255 (CS1) Programming
Methods:Java
A 10.0
24-25 Design Tech High School
10 * Chemistry A 5.0 A 5.0
10 * D.Lab: CoDesigners Honors A 5.0 A- 5.0
Comments
Legend
`;

const TERM_COLUMNS = { summer: 52, fall: 64, spring: 76 };

function placeCells(label: string, values: Partial<Record<keyof typeof TERM_COLUMNS, string>>) {
  let line = label;
  for (const term of ["summer", "fall", "spring"] as const) {
    if (!values[term]) continue;
    line = line.padEnd(TERM_COLUMNS[term], " ") + values[term];
  }
  return line;
}

function sideBySide(left: string[], right: string[], columnWidth = 96) {
  return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => {
    const leftLine = left[index] ?? "";
    const rightLine = right[index] ?? "";
    return leftLine.padEnd(columnWidth, " ") + rightLine;
  }).join("\n");
}

const TRANSCRIPT_LAYOUT = [
  placeCells("GR Course", { summer: "S0 CR", fall: "S1 CR", spring: "S2 CR" }),
  "25-26 College of San Mateo",
  placeCells("11 * CIS 127 HTML5 and CSS", { fall: "A 5.0" }),
  "25-26 Design Tech High School",
  placeCells("11 * Advanced Physics Honors", { fall: "A 5.0", spring: "A 5.0" }),
  placeCells("11 Q1 Internship/TA (Teacher's Assistant)", { fall: "P 2.5" }),
  "24-25 Skyline College",
  placeCells("10 * CIS 255 (CS1) Programming Methods:Java", { spring: "A 10.0" }),
  "24-25 Design Tech High School",
  placeCells("10 * Chemistry", { fall: "A 5.0", spring: "A 5.0" }),
  placeCells("10 * D.Lab: CoDesigners Honors", { fall: "A 5.0", spring: "A- 5.0" }),
  "Comments",
  "Legend"
].join("\n");

describe("deterministic d.tech transcript parser", () => {
  it("extracts and reconciles deterministic transcript rows", () => {
    {
    expect(transcriptMimeType("application/octet-stream", "DTech June 2026.pdf")).toBe("application/pdf");
    expect(transcriptMimeType("application/x-download", "DTech June 2026.pdf")).toBe("application/pdf");
    expect(transcriptMimeType("", "completed-courses.CSV")).toBe("text/csv");
    const catalog = [
      { id: "english", name: "English 3 / English 3 Honors" },
      { id: "statistics", name: "Advanced Statistics / Advanced Statistics Honors" },
      { id: "innovation", name: "Innovation Diploma" },
      { id: "english-2", name: "English 2 / English 2 Honors" }
    ] as Course[];
    expect(findTranscriptCatalogMatch("English 3 Honors", catalog)?.id).toBe("english");
    expect(findTranscriptCatalogMatch("Advanced Statisics Honors", catalog)?.id).toBe("statistics");
    expect(findTranscriptCatalogMatch("D.Lab: Innovation Diplma Honors", catalog)?.id).toBe("innovation");
    expect(findTranscriptCatalogMatch("English 4 Honors", catalog)).toBeNull();
    const result = parseDtechTranscriptText(TRANSCRIPT_TEXT, TRANSCRIPT_LAYOUT);

    expect(TRANSCRIPT_PARSER_VERSION).toBe("transcript-layout-text-1.7.0");
    expect(result.courses).toHaveLength(6);
    expect(result.academic_years).toEqual(["2024-2025", "2025-2026"]);
    expect(result.summary).toContain("2 SMCCD course rows");
    expect(result.courses[0]).toMatchObject({
      course_name: "CIS 127 HTML5 and CSS",
      course_code: "CIS 127",
      institution_name: "College of San Mateo",
      grade_level: 11,
      letter_grade: "A",
      credits: 5,
      term: "fall",
      weighted: true
    });
    expect(result.courses.find((course) => course.course_name.includes("Internship"))).toMatchObject({
      letter_grade: "P",
      subject: "Personal Development",
      credits: 2.5,
      weighted: false
    });
    expect(result.courses.find((course) => course.course_name === "Chemistry")).toMatchObject({
      term: "full_year",
      weighted: false
    });
    }

    {
    const result = parseDtechTranscriptText(TRANSCRIPT_TEXT, TRANSCRIPT_LAYOUT);
    const programming = result.courses.find((course) => course.course_code === "CIS 255");
    const dlab = result.courses.find((course) => course.course_name.includes("CoDesigners"));

    expect(programming).toMatchObject({
      course_name: "CIS 255 (CS1) Programming Methods:Java",
      institution_name: "Skyline College",
      letter_grade: "A",
      credits: 10,
      term: "spring"
    });
    expect(dlab).toMatchObject({ letter_grade: "A-", credits: 10, confidence: "likely", weighted: true });
    expect(result.conflicts).toEqual([]);
    }
  });

  it("handles pass-fail, missing-term, and multi-page layouts", () => {
    {
    const result = parseDtechTranscriptText("25-26 Skyline College\n11 * ETHN 103 Asian American US Institutions");

    expect(result.courses).toEqual([]);
    expect(result.conflicts[0]).toContain("No final grade and credit pair");
    }

    {
    const result = parseDtechTranscriptText(`
25-26 Design Tech High School
11 Q1 Documentary Film P 2.5
11 Q2 Experimental Studio F 0.0
Comments
`);

    expect(result.courses).toHaveLength(2);
    expect(result.courses[0]).toMatchObject({
      course_name: "Documentary Film",
      subject: "Personal Development",
      letter_grade: "P",
      term: "fall",
      weighted: false
    });
    expect(result.courses[0].evidence).toContain("intersession pass/fail course");
    expect(result.courses[0].evidence).toContain("Personal Development credit");
    expect(result.courses[1]).toMatchObject({
      course_name: "Experimental Studio",
      subject: "Personal Development",
      letter_grade: "F",
      term: "fall",
      credits: 0,
      weighted: false
    });
    expect(result.courses[1].evidence).not.toContain("Personal Development credit");
    }

    {
    const result = parseDtechTranscriptText(`
25-26 College of San Mateo
11 * CIS 127 HTML5 and CSS A 5.0
Comments
`);

    expect(result.courses[0]).toMatchObject({ term: "full_year", confidence: "uncertain" });
    expect(result.conflicts[0]).toContain("semester column was not available");
    }
  });

  it("captures complete college history without false completion", () => {
    {
    const header = placeCells("GR Course", { summer: "S0 CR", fall: "S1 CR", spring: "S2 CR" });
    const layout = [
      "[[PILOT_PDF_PAGE:1]]",
      sideBySide(
        [
          header,
          "25-26 Design Tech High School",
          placeCells("11 * English 3", { fall: "A 5.0", spring: "A 5.0" }),
          placeCells("11 * Physics", { spring: "B 5.0" }),
          "Comments",
          "Legend",
          "P = Pass"
        ],
        [
          header,
          "24-25 Design Tech High School",
          placeCells("10 * World History", { fall: "A 5.0", spring: "A 5.0" }),
          "24-25 Skyline College",
          placeCells("10 * CIS 110 Introduction to Computer Science", { spring: "A 3.0" }),
          "Comments",
          "Legend"
        ]
      ),
      "[[PILOT_PDF_PAGE:2]]",
      sideBySide(
        [
          header,
          "23-24 Design Tech High School",
          placeCells("9 * Algebra 1", { fall: "B 5.0", spring: "B 5.0" }),
          "Comments",
          "Legend"
        ],
        [
          header,
          "25-26 College of San Mateo",
          placeCells("11 * HIST 101 History of Western Civilization I", { fall: "A 3.0" }),
          "Comments",
          "Legend"
        ]
      )
    ].join("\n");

    const result = parseDtechTranscriptText("", layout);

    expect(result.courses).toHaveLength(6);
    expect(result.academic_years).toEqual(["2023-2024", "2024-2025", "2025-2026"]);
    expect(result.courses.map((course) => course.course_name)).toEqual([
      "English 3",
      "Physics",
      "World History",
      "CIS 110 Introduction to Computer Science",
      "Algebra 1",
      "HIST 101 History of Western Civilization I"
    ]);
    expect(result.courses.find((course) => course.course_name === "Physics")).toMatchObject({ term: "spring" });
    expect(result.courses.find((course) => course.course_code === "HIST 101")).toMatchObject({
      institution_name: "College of San Mateo",
      term: "fall"
    });

    const flattenedMissingRightColumn = `
25-26 Design Tech High School
11 * English 3 A 5.0 A 5.0
11 * Physics B 5.0
Comments
`;
    const merged = parseDtechTranscriptText(flattenedMissingRightColumn, layout);
    expect(merged.courses).toHaveLength(6);
    expect(merged.courses.map((course) => course.course_code)).toContain("HIST 101");
    }

    {
    const source = `
San Mateo County CC District
Unofficial Academic Transcript
INSTITUTION CREDIT
Term: Fall 2025
Subject   Course             Campus       Level    Title                        Grade      Credit     Quality    R
CIS       127                College of   01       HTML5 and CSS                A          3.000      12.00
                             San Mateo
ETHN      103                Skyline      01       Asian American US            A          3.000      12.00
                             College               Institutions
Term Totals
COURSE(S) IN PROGRESS
Term: Fall 2026
MATH      270                College of   01       Linear Algebra               3.000
`;
    const result = parseSmccdTranscriptText(source, source);

    expect(result.courses).toHaveLength(2);
    expect(result.summary).toContain("2 completed SMCCD course rows");
    expect(result.courses[0]).toMatchObject({
      course_name: "CIS 127 HTML5 and CSS",
      course_code: "CIS 127",
      institution_name: "College of San Mateo",
      school_year: "2025-2026",
      term: "fall",
      college_units: 3,
      weighted: true
    });
    expect(result.courses[1]).toMatchObject({
      course_name: "ETHN 103 Asian American US Institutions",
      institution_name: "Skyline College"
    });
    expect(inferTranscriptGradeLevel("2023-2024", 2027)).toBe(9);
    expect(inferTranscriptGradeLevel("2025-2026", 2027)).toBe(11);
    }

    {
    const flattened = `
23-24 College of San Mateo
9 * CIS 110 Introduction to CIS A 5.0
23-24 Design Tech High School
9 Q1 Oracle Education: Neural Networks P 2.5
Comments
`;
    const misleadingLayout = `
GR Course S0 CR S1 CR S2 CR
23-24 College of San Mateo
9 Q1 Oracle Education: Neural Networks P 2.5
23-24 Design Tech High School
9 * CIS 110 Introduction to CIS A 5.0
Comments
`;

    const result = parseDtechTranscriptText(flattened, misleadingLayout);
    const intersession = result.courses.find((course) => course.course_name === "Oracle Education: Neural Networks");

    expect(intersession).toMatchObject({
      institution_name: "Design Tech High School",
      subject: "Personal Development",
      term: "fall",
      weighted: false,
      letter_grade: "P"
    });
    expect(result.summary).toContain("1 SMCCD course row");
    }
  });
});
