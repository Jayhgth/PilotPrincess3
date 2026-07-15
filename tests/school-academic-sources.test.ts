import { describe, expect, it } from "vitest";
import {
  academicAuthorityForSchool,
  decodeHtmlEntities,
  extractCatalogCourses,
  extractGraduationRequirements,
  gradeLevelsFromText,
  mappedRequirementAreasForCourse,
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

  it("uses the local graduation column from an official HTML comparison table", () => {
    const rows = extractGraduationRequirements(`
HTML_TABLE\tSubject\tLocal diploma\tUC/CSU
HTML_TABLE\tSocial Studies (a)\t40 Ethnic Studies, World History, US History and Government\t20
HTML_TABLE\tEnglish (b)\t40\t40
HTML_TABLE\tMathematics (c)\t30 Through Algebra 2\t30 Recommended 40
HTML_TABLE\tLaboratory Science (d)\t20 Biological and Physical Lab Science\t20 Recommended 30
HTML_TABLE\tWorld Language (e)\t20 Same language through level 2\t20
HTML_TABLE\tVisual & Performing Arts (f)\t10\t10
HTML_TABLE\tElectives (g)\t25\t10
HTML_TABLE\tPhysical Education\t20\t0
HTML_TABLE\tCareer Tech Ed\t10\t0
HTML_TABLE\tLiving Skills\t5\t0
`);
    const byArea = new Map(rows.map((row) => [row.area, row]));
    expect(byArea.get("math")?.credits_required).toBe(30);
    expect(byArea.get("electives")?.credits_required).toBe(25);
    expect(byArea.get("career_technical_education")?.credits_required).toBe(10);
    expect(byArea.get("personal_development")?.credits_required).toBe(5);
    expect(validateGraduationRequirements(rows)).toMatchObject({ publishable: true, credits_total: 220 });
  });

  it("extracts an official image-only graduation table from OCR text without treating years as credits", () => {
    const rows = extractGraduationRequirements(`
AIMS HS A-G+ Graduation Standards
English 4 4 40
Math 3 4 40
Science 2 4 40
History 2 4 40
Visual Performing 1 2 20 N/A
Arts
PE 2 2 20
Foreign Language 2 2 20
Electives 1
AIMS Core 4 40
Electives requirement, see the course guide.
`);
    const byArea = new Map(rows.map((row) => [row.area, row]));
    expect(byArea.get("visual_performing_arts")?.credits_required).toBe(20);
    expect(byArea.get("electives")?.credits_required).toBe(40);
    expect(validateGraduationRequirements(rows)).toMatchObject({ publishable: true, credits_total: 260 });
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

  it("expands grade ranges instead of dropping their middle grades", () => {
    expect(gradeLevelsFromText("Grades 9-12")).toEqual([9, 10, 11, 12]);
    expect(gradeLevelsFromText("Recommended grades 10, 11-12")).toEqual([10, 11, 12]);
  });

  it("maps local course identity before A-G electives and honors an advanced-language pathway", () => {
    const requirements = [{ area: "career_technical_education", name: "Career Technical Education or advanced World Language", notes: "Third level of world language or one year of CTE." }];
    expect(mappedRequirementAreasForCourse({ name: "CTE- AP Computer Science A", subject: "Computer Science", uc_ag_area: "g" }, requirements)).toEqual(["career_technical_education"]);
    expect(mappedRequirementAreasForCourse({ name: "Spanish III", subject: "World Language", uc_ag_area: "e" }, requirements)).toEqual(["career_technical_education"]);
    expect(mappedRequirementAreasForCourse({ name: "Spanish II", subject: "World Language", uc_ag_area: "e" }, requirements)).toEqual(["world_language"]);
    expect(mappedRequirementAreasForCourse({ name: "AP Psychology", subject: "Social Science", uc_ag_area: "g" }, requirements)).toEqual(["electives"]);
    expect(mappedRequirementAreasForCourse({ name: "Economics", subject: "Elective", uc_ag_area: "g" }, requirements)).toEqual(["social_science"]);
  });

  it("merges local placement metadata into the matching honors variant only", () => {
    const ucop = [
      { ...ucopCourseValues({ courseId: "regular", title: "Precalculus", disciplineName: "Mathematics", subjectAreaCode: "c", courseLengthId: 2, isHonors: 0 }), grade_levels: [] },
      { ...ucopCourseValues({ courseId: "honors", title: "Pre-Calc Honors", disciplineName: "Mathematics", subjectAreaCode: "c", courseLengthId: 2, isHonors: 1 }), grade_levels: [] }
    ];
    const local = [
      { ...ucop[0], external_course_id: "local-regular", name: "PRE-CALCULUS", grade_levels: [10, 11, 12], is_honors: false, is_weighted: false },
      { ...ucop[1], external_course_id: "local-honors", name: "PRECALCULUS HONORS", grade_levels: [9, 10, 11, 12], is_honors: true, is_weighted: true }
    ];
    const merged = mergeOfficialCourses(ucop, local);
    expect(merged.find((course) => course.external_course_id === "regular")?.grade_levels).toEqual([10, 11, 12]);
    expect(merged.find((course) => course.external_course_id === "honors")?.grade_levels).toEqual([9, 10, 11, 12]);
  });

  it("does not publish catalog section headings as schedulable courses", () => {
    const courses = extractCatalogCourses(`
NON DEPARTMENTAL
AP CAPSTONE
AP SEMINAR-HP (ELECTIVE)
Prerequisites: None
Grades 10, 11
The first course in the AP Capstone sequence.
AVID I, II, III, IV
Grades 9-12
Program heading.
`);
    expect(courses.map((course) => course.name)).toEqual(["AP SEMINAR-HP (ELECTIVE)"]);
    expect(courses[0]?.prerequisites).toEqual([]);
  });

  it("normalizes common local requirement labels without forcing unknown labels", () => {
    expect(normalizeRequirementArea("Fine Arts / VAPA")).toBe("visual_performing_arts");
    expect(normalizeRequirementArea("Physical Education")).toBe("physical_education");
    expect(normalizeRequirementArea("Career Tech Ed")).toBe("career_technical_education");
    expect(normalizeRequirementArea("Living Skills")).toBe("personal_development");
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
