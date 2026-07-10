import { describe, expect, it } from "vitest";

import {
  buildDtechPrerequisiteEquivalencies,
  buildReviewedDtechToSmccdPrerequisiteEquivalencies,
  clearanceFromStoredRecord,
  evaluateParsedPrerequisites,
  parseSmccdCoursePrerequisites
} from "@/lib/prerequisites";
import type { CatalogCourse, SmccdPrerequisiteCourseInput } from "@/lib/prerequisites";

function smccdCourse(overrides: Partial<SmccdPrerequisiteCourseInput> = {}): SmccdPrerequisiteCourseInput {
  return {
    id: "CSM:ENGL C1000",
    collegeCode: "CSM",
    courseCode: "ENGL C1000",
    title: "Academic Reading and Writing",
    prerequisites: [],
    corequisites: [],
    recommendedPreparation: [],
    catalogUrl: "https://catalog.collegeofsanmateo.edu/current/courses/english/engl-C1000.php",
    sourceYear: "2025-2026",
    detailStatus: "verified",
    ...overrides
  };
}

describe("SMCCD prerequisite adapters", () => {
  it("keeps ENGL C1000 in review until an official placement clearance is recorded", () => {
    const english = smccdCourse({
      prerequisites: ["Placement as determined by the college's multiple measures assessment process."],
      recommendedPreparation: ["Appropriate skill level as indicated by at least a 2.6 GPA in high school."]
    });
    const parsed = parseSmccdCoursePrerequisites(english, [english]);
    const input = {
      target: { courseId: english.id, code: english.courseCode, name: english.title, termIndex: 3 },
      courses: []
    };

    expect(parsed.parseConfidence).toBe("exact");
    expect(evaluateParsedPrerequisites(parsed, input).status).toBe("needs_review");
    expect(
      evaluateParsedPrerequisites(parsed, {
        ...input,
        clearances: [
          {
            id: "english-placement",
            type: "placement" as const,
            target: { id: english.id, code: english.courseCode, name: english.title },
            status: "approved" as const,
            authority: "CSM Assessment Services"
          }
        ]
      }).status
    ).toBe("satisfied");
  });

  it("supports course, approved-equivalency, and placement alternatives without treating recommendations as requirements", () => {
    const intermediateAlgebra = smccdCourse({
      id: "CAN:MATH 120",
      collegeCode: "CAN",
      courseCode: "MATH 120",
      title: "Intermediate Algebra",
      catalogUrl: "https://catalog.canadacollege.edu/current/courses/mathematics/math-120.php"
    });
    const businessCalculus = smccdCourse({
      id: "CAN:MATH 241",
      collegeCode: "CAN",
      courseCode: "MATH 241",
      title: "Business Calculus I",
      prerequisites: ["Successful completion of Intermediate Algebra or equivalent, or placement by other measures as applicable."],
      recommendedPreparation: ["Review algebra before the term begins."],
      catalogUrl: "https://catalog.canadacollege.edu/current/courses/mathematics/math-241.php"
    });
    const parsed = parseSmccdCoursePrerequisites(businessCalculus, [intermediateAlgebra, businessCalculus]);

    expect(parsed.parseConfidence).toBe("exact");
    expect(parsed.originalTexts).not.toContain("Review algebra before the term begins.");
    expect(
      evaluateParsedPrerequisites(parsed, {
        target: { courseId: businessCalculus.id, code: businessCalculus.courseCode, name: businessCalculus.title, termIndex: 4 },
        courses: [
          {
            instanceId: "math-120",
            courseId: intermediateAlgebra.id,
            code: intermediateAlgebra.courseCode,
            name: intermediateAlgebra.title,
            status: "completed",
            termIndex: 2,
            grade: "B"
          }
        ]
      }).status
    ).toBe("satisfied");
  });

  it("models challenge-based alternatives and strict course-field corequisites", () => {
    const music100 = smccdCourse({ id: "SKY:MUS. 100", collegeCode: "SKY", courseCode: "MUS. 100", title: "Fundamentals of Music" });
    const music105 = smccdCourse({ id: "SKY:MUS. 105", collegeCode: "SKY", courseCode: "MUS. 105", title: "Music Theory I" });
    const music111 = smccdCourse({
      id: "SKY:MUS. 111",
      collegeCode: "SKY",
      courseCode: "MUS. 111",
      title: "Musicianship I",
      prerequisites: [
        "MUS. 100 or equivalent. Students with prior experience may bypass the prerequisite by filing a prerequisite challenge petition and passing the required quiz."
      ],
      corequisites: ["MUS. 105"],
      catalogUrl: "https://catalog.skylinecollege.edu/current/courses/music/mus-111.php"
    });
    const parsed = parseSmccdCoursePrerequisites(music111, [music100, music105, music111]);
    const rules = parsed.rule.kind === "all_of" ? parsed.rule.rules : [];

    expect(parsed.parseConfidence).toBe("exact");
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "any_of" }),
        expect.objectContaining({ kind: "course", timing: "concurrent", course: expect.objectContaining({ id: music105.id }) })
      ])
    );
  });

  it("builds SMCCD-to-d.tech mappings in one direction only", () => {
    const dtechCatalog: CatalogCourse[] = [{ id: "dtech-precalc", name: "Precalculus" }];
    const [mapping] = buildDtechPrerequisiteEquivalencies(
      [
        {
          normalizedCourseCode: "MATH 222",
          highSchoolEquivalent: "Precalculus",
          confidence: "verified",
          sourceId: "dtech-chart"
        }
      ],
      dtechCatalog
    );

    expect(mapping).toMatchObject({
      from: { code: "MATH 222" },
      to: { id: "dtech-precalc" },
      status: "approved"
    });
  });

  it("requires a reviewed directional decision before a d.tech course satisfies an SMCCD prerequisite", () => {
    const algebra = smccdCourse({
      id: "CAN:MATH 120",
      collegeCode: "CAN",
      courseCode: "MATH 120",
      title: "Intermediate Algebra"
    });
    const businessCalculus = smccdCourse({
      id: "CAN:MATH 241",
      collegeCode: "CAN",
      courseCode: "MATH 241",
      title: "Business Calculus I",
      prerequisites: ["MATH 120"],
      catalogUrl: "https://catalog.canadacollege.edu/current/courses/mathematics/math-241.php"
    });
    const parsed = parseSmccdCoursePrerequisites(businessCalculus, [algebra, businessCalculus]);
    const reviewed = buildReviewedDtechToSmccdPrerequisiteEquivalencies(
      [{
        id: "college-decision-1",
        from: { id: "dtech-algebra-2", name: "Algebra 2" },
        toSmccdCourseId: algebra.id,
        appliesToTargetCourseId: businessCalculus.id,
        status: "approved",
        verificationStatus: "approved",
        authority: "Cañada College prerequisite office"
      }],
      [algebra, businessCalculus]
    );
    const input = {
      target: { courseId: businessCalculus.id, code: businessCalculus.courseCode, name: businessCalculus.title, termIndex: 4 },
      courses: [{ courseId: "dtech-algebra-2", name: "Algebra 2", status: "completed" as const, termIndex: 2 }]
    };

    expect(evaluateParsedPrerequisites(parsed, { ...input, equivalencies: reviewed }).status).toBe("satisfied");
    expect(
      evaluateParsedPrerequisites(parsed, {
        ...input,
        equivalencies: reviewed.map((mapping) => ({ ...mapping, status: "pending" as const }))
      }).status
    ).toBe("needs_review");
  });

  it("does not promote a student-reported clearance before independent verification", () => {
    const english = smccdCourse({ prerequisites: ["Placement as determined by the college's multiple measures assessment process."] });
    const reported = clearanceFromStoredRecord({
      id: "reported-placement",
      targetCourseId: english.id,
      clearanceType: "placement",
      status: "approved",
      verificationStatus: "pending",
      authority: "Reported CSM placement result"
    }, english);

    expect(reported.status).toBe("pending");
    expect(() => clearanceFromStoredRecord({
      id: "wrong-course-placement",
      targetCourseId: "CAN:ENGL C1000",
      clearanceType: "placement",
      status: "approved",
      verificationStatus: "approved",
      authority: "Reported Cañada placement result"
    }, english)).toThrow("targets CAN:ENGL C1000");
  });
});
