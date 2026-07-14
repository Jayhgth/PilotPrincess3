import { describe, expect, it } from "vitest";
import {
  academicAuthorityForSchool,
  decodeHtmlEntities,
  extractCatalogCourses,
  extractGraduationRequirements,
  mergeOfficialCourses,
  normalizeRequirementArea,
  ucopCourseValues,
  validateGraduationRequirements
} from "../scripts/lib/school-academic-sources.mjs";

const SUHSD_EXCERPT = `
Electives (60 units for graduation)
ENGLISH LANGUAGE ARTS (40 units for graduation)
CTE or World Language 3+
Students who do not take a third level of world language must take a year of Career Technical Education to meet district graduation requirements.
MATHEMATICS (20 units for graduation)
PHYSICAL EDUCATION (20 units for graduation)
SCIENCE (20 units for graduation)
All students will take a year of physical science and a year of life science.
SOCIAL STUDIES (37.5 units for graduation)
VISUAL AND PERFORMING ARTS (10 credits)
`;

describe("school academic source ingestion", () => {
  it("derives district and charter authority boundaries from CDS identity", () => {
    expect(academicAuthorityForSchool({ cds_code: "41690624130993", governance_type: "district", id: "carlmont" })).toBe("district:4169062");
    expect(academicAuthorityForSchool({ cds_code: "41690470129759", governance_type: "charter", id: "dtech" })).toBe("charter:41690470129759");
  });

  it("extracts a representative current district requirement set with exact evidence", () => {
    const rows = extractGraduationRequirements(SUHSD_EXCERPT);
    const byArea = new Map(rows.map((row) => [row.area, row]));
    expect(byArea.get("english")?.credits_required).toBe(40);
    expect(byArea.get("social_science")?.credits_required).toBe(37.5);
    expect(byArea.get("physical_education")?.credits_required).toBe(20);
    expect(byArea.get("electives")?.credits_required).toBe(60);
    expect(byArea.get("career_technical_education")?.credits_required).toBe(10);
    expect(validateGraduationRequirements(rows)).toMatchObject({ publishable: true, missing_core_areas: [] });
    expect(rows.every((row) => row.evidence.length > 0)).toBe(true);
  });

  it("refuses to publish partial or weak requirement extraction", () => {
    const rows = extractGraduationRequirements("English (40 credits)\nMath (20 credits)");
    expect(validateGraduationRequirements(rows)).toMatchObject({ publishable: false });
  });

  it("uses the default all-student plan without merging exception pathways", () => {
    const rows = extractGraduationRequirements(`
Plan 1: All Students
English\t8\t40\t
Mathematics\t6\t30\t
History/Social Science\t6\t30\t
Laboratory Science\t4\t20\t
World Languages\t4\t20\t
Visual and Performing Arts\t2\t10\t
Physical Education\t4\t20\t
Electives\t10\t50\t
Plan 3: Transfer exemption
English\t6\t30\t
Mathematics\t4\t20\t
`);
    expect(rows.find((row) => row.area === "english")?.credits_required).toBe(40);
    expect(rows.find((row) => row.area === "math")?.credits_required).toBe(30);
    expect(validateGraduationRequirements(rows).publishable).toBe(true);
  });

  it("parses multiline default-plan tables without duplicating embedded credit cells", () => {
    const rows = extractGraduationRequirements(`
Plan 1: All Students
History/Social Science
Three years including US History
\t6\t30\t
College Preparatory English\t8\t40\t
Mathematics\t6\t30\t
Laboratory Science\t4\t20\t
World Languages\t4\t20\t
Visual and Performing Arts\t2\t10\t
Physical Education\n+See additional notes.\n+\t4\t20\t
Health Education\t1\t5\t
College & Career Course\t1\t5\t
Electives\n+Beginning with the Class of 2028, ten credits must be Ethnic Studies.\n+\t10\t50\t
Plan 2: Exception pathway
English\t6\t30\t
`);
    expect(rows).toHaveLength(10);
    expect(validateGraduationRequirements(rows)).toMatchObject({ publishable: true, credits_total: 230 });
    expect(rows.filter((row) => row.name === "Health Education")).toHaveLength(1);
  });

  it("extracts full official spreadsheet catalogs and keeps non-A-G offerings", () => {
    const courses = extractCatalogCourses(`Course Name,Description,Typical Pathway by Grade,Prerequisites,UC A-G approved\nEthnic Studies,History and identity,9,None,A (History)\nGovernment,Fall semester class,12,US History,A (History)\nYearbook,Student publication,9-12,None,No`);
    expect(courses).toHaveLength(3);
    expect(courses[1]).toMatchObject({ name: "Government", credits: 5, term_type: "semester", prerequisites: ["US History"] });
    expect(courses[2]).toMatchObject({ name: "Yearbook", uc_ag_area: null, subject: "Elective" });
  });

  it("extracts course metadata from an official planning-handbook document", () => {
    const courses = extractCatalogCourses(`
Course Offerings
COMPUTER SCIENCE
+AP COMPUTER SCIENCE A-HP
Prerequisites: Algebra II and Advanced CS Structure
Grades 11, 12
A one-year college-level Java course.
ENGLISH
ENGLISH I-P
Grade 9
English I develops writing and literary analysis.
`);
    expect(courses).toHaveLength(2);
    expect(courses[0]).toMatchObject({ name: "AP COMPUTER SCIENCE A", subject: "Computer Science", grade_levels: [11, 12], is_honors: true });
    expect(courses[1]).toMatchObject({ name: "ENGLISH I", subject: "English", grade_levels: [9] });
  });

  it("normalizes common local requirement labels without forcing unknown labels", () => {
    expect(normalizeRequirementArea("Fine Arts / VAPA")).toBe("visual_performing_arts");
    expect(normalizeRequirementArea("Physical Education")).toBe("physical_education");
    expect(normalizeRequirementArea("Local capstone seminar")).toBe("other");
  });

  it("preserves stable UCOP identity and decodes institution text", () => {
    const row = ucopCourseValues({
      courseId: "course-1",
      recordId: "ABC123",
      title: "Spanish 3 &amp; Culture",
      disciplineName: "Language Other Than English",
      subjectAreaCode: "e",
      courseLengthId: 2,
      isHonors: 1,
      transcriptAbbreviations: "SPAN 3 H"
    });
    expect(row).toMatchObject({
      external_course_id: "course-1",
      name: "Spanish 3 & Culture",
      credits: 10,
      uc_ag_area: "e",
      is_honors: true,
      review_status: "approved"
    });
    expect(decodeHtmlEntities("Ca&ntilde;ada College")).toBe("Cañada College");
  });

  it("deduplicates repeated UCOP titles before database publication", () => {
    const courses = mergeOfficialCourses([
      { external_course_id: "old", name: "Web Development", is_honors: false, grade_levels: [] },
      { external_course_id: "honors", name: "Web Development", is_honors: true, grade_levels: [] }
    ], []);
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ external_course_id: "honors", is_honors: true });
  });
});
