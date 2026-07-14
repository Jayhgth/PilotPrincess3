import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { auditSmccdPrerequisites, parseSmccdCoursePrerequisites } from "@/lib/prerequisites";
import type { SmccdPrerequisiteCourseInput } from "@/lib/prerequisites";

interface ArtifactCourse {
  collegeCode: SmccdPrerequisiteCourseInput["collegeCode"];
  courseCode: string;
  title: string;
  degreeApplicable: boolean;
  attributes: string[];
  prerequisites: string[];
  corequisites: string[];
  recommendedPreparation: string[];
  catalogUrl: string;
  detailStatus: SmccdPrerequisiteCourseInput["detailStatus"];
}

function artifactCourses(): Array<SmccdPrerequisiteCourseInput & Pick<ArtifactCourse, "degreeApplicable" | "attributes">> {
  const artifact = JSON.parse(
    readFileSync(new URL("../../supabase/catalog/smccd-2025-2026.json", import.meta.url), "utf8")
  ) as { catalogYear: string; courses: ArtifactCourse[] };
  return artifact.courses.map((course) => ({
    id: `${course.collegeCode}:${course.courseCode}`,
    collegeCode: course.collegeCode,
    courseCode: course.courseCode,
    title: course.title,
    degreeApplicable: course.degreeApplicable,
    attributes: course.attributes,
    prerequisites: course.prerequisites,
    corequisites: course.corequisites,
    recommendedPreparation: course.recommendedPreparation,
    catalogUrl: course.catalogUrl,
    sourceYear: artifact.catalogYear,
    detailStatus: course.detailStatus
  }));
}

describe("checked-in SMCCD prerequisite catalog", () => {
  it("preserves ENGL C1000 as degree-applicable general education with placement review", () => {
    const courses = artifactCourses();
    const englishRows = courses.filter((course) => course.courseCode === "ENGL C1000");

    expect(englishRows).toHaveLength(3);
    for (const course of englishRows) {
      expect(course.degreeApplicable).toBe(true);
      expect(course.attributes.join(" ")).toContain("Area 1A");
      expect(course.prerequisites.join(" ")).toContain("multiple measures assessment process");
      expect(parseSmccdCoursePrerequisites(course, courses).parseConfidence).toBe("exact");
    }
  });

  it("audits the complete three-college prerequisite graph conservatively", () => {
    const audit = auditSmccdPrerequisites(artifactCourses());
    expect(audit.courseCount).toBe(2476);
    expect(audit.referenceCount).toBeGreaterThanOrEqual(800);
    expect(audit.unresolvedClauseCount).toBeGreaterThan(0);
    expect(audit.unresolvedClauseCount).toBeLessThanOrEqual(300);
    expect(audit.issues.some((issue) => issue.kind === "unresolved_prerequisite")).toBe(true);
    expect(audit.issues.some((issue) => issue.kind === "missing_catalog_reference")).toBe(true);
    expect(audit.issues.some((issue) => issue.kind === "cycle")).toBe(true);
    expect(Object.values(audit.byCollege).reduce((sum, college) => sum + college.courseCount, 0)).toBe(2476);
  });
});
