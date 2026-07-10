import { describe, expect, it } from "vitest";
import { parseDtechTranscriptText, TRANSCRIPT_PARSER_VERSION } from "@/server/transcript-parser";

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

describe("deterministic d.tech transcript parser", () => {
  it("extracts high-school and SMCCD rows without an LLM", () => {
    const result = parseDtechTranscriptText(TRANSCRIPT_TEXT);

    expect(TRANSCRIPT_PARSER_VERSION).toBe("dtech-layout-text-1.3.0");
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
      weighted: true
    });
    expect(result.courses.find((course) => course.course_name.includes("Internship"))).toMatchObject({
      letter_grade: "P",
      subject: "Personal Development",
      credits: 2.5,
      weighted: false
    });
    expect(result.courses.find((course) => course.course_name === "Chemistry")).toMatchObject({
      weighted: false
    });
  });

  it("joins wrapped course titles and preserves reviewable grade conflicts", () => {
    const result = parseDtechTranscriptText(TRANSCRIPT_TEXT);
    const programming = result.courses.find((course) => course.course_code === "CIS 255");
    const dlab = result.courses.find((course) => course.course_name.includes("CoDesigners"));

    expect(programming).toMatchObject({
      course_name: "CIS 255 (CS1) Programming Methods:Java",
      institution_name: "Skyline College",
      letter_grade: "A",
      credits: 10
    });
    expect(dlab).toMatchObject({ letter_grade: "A-", credits: 10, confidence: "likely", weighted: true });
    expect(result.conflicts).toEqual([]);
  });

  it("does not invent a completed row when no final grade is printed", () => {
    const result = parseDtechTranscriptText("25-26 Skyline College\n11 * ETHN 103 Asian American US Institutions");

    expect(result.courses).toEqual([]);
    expect(result.conflicts[0]).toContain("No final grade and credit pair");
  });

  it("classifies quarter-coded P and F rows as d.tech intersession pass/fail courses", () => {
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
      weighted: false
    });
    expect(result.courses[0].evidence).toContain("intersession pass/fail course");
    expect(result.courses[0].evidence).toContain("Personal Development credit");
    expect(result.courses[1]).toMatchObject({
      course_name: "Experimental Studio",
      subject: "Personal Development",
      letter_grade: "F",
      credits: 0,
      weighted: false
    });
    expect(result.courses[1].evidence).not.toContain("Personal Development credit");
  });
});
