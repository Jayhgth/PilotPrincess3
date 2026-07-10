import { describe, expect, it } from "vitest";

import { auditPrerequisiteGraph } from "@/lib/prerequisites";
import type { CatalogCourse } from "@/lib/prerequisites";

describe("prerequisite graph audit", () => {
  it("detects missing catalog references", () => {
    const catalog: CatalogCourse[] = [
      { id: "target", name: "Target", gradeLevels: [10], prerequisites: ["Missing 101"] }
    ];

    expect(auditPrerequisiteGraph(catalog).issues).toEqual([
      expect.objectContaining({
        kind: "missing_catalog_reference",
        courseId: "target",
        reference: { name: "Missing 101" }
      })
    ]);
  });

  it("detects prerequisite cycles and distinguishes prior from co-requisite cycles", () => {
    const priorCycle: CatalogCourse[] = [
      { id: "a", name: "Course A", prerequisites: ["Course B"] },
      { id: "b", name: "Course B", prerequisites: ["Course A"] }
    ];
    const coRequisiteCycle: CatalogCourse[] = [
      { id: "a", name: "Course A", prerequisites: ["Course B co-requisite"] },
      { id: "b", name: "Course B", prerequisites: ["Course A co-requisite"] }
    ];

    expect(auditPrerequisiteGraph(priorCycle).issues).toContainEqual(
      expect.objectContaining({ kind: "cycle", severity: "error", includesPriorRequirement: true })
    );
    expect(auditPrerequisiteGraph(coRequisiteCycle).issues).toContainEqual(
      expect.objectContaining({ kind: "cycle", severity: "warning", includesPriorRequirement: false })
    );
  });

  it("detects impossible grade ordering and target grade constraints", () => {
    const catalog: CatalogCourse[] = [
      { id: "base", name: "Base Course", gradeLevels: [9], prerequisites: [] },
      { id: "target", name: "Target", gradeLevels: [9], prerequisites: ["Base Course", "Grade 11 or 12"] }
    ];

    const issues = auditPrerequisiteGraph(catalog).issues.filter((issue) => issue.kind === "impossible_grade_sequence");
    expect(issues).toHaveLength(2);
    expect(issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("not offered at any grade allowed"),
        expect.stringContaining("cannot occur before")
      ])
    );
  });

  it("surfaces unresolved source text instead of treating it as a graph edge", () => {
    const catalog: CatalogCourse[] = [
      { id: "precalc", name: "Precalculus", gradeLevels: [10, 11, 12], prerequisites: [] },
      { id: "advanced", name: "Advanced Physics", gradeLevels: [11, 12], prerequisites: ["Precalculus preferred"] }
    ];

    const audit = auditPrerequisiteGraph(catalog);
    expect(audit.referenceCount).toBe(0);
    expect(audit.unresolvedClauseCount).toBe(1);
    expect(audit.issues).toEqual([
      expect.objectContaining({
        kind: "unresolved_prerequisite",
        courseName: "Advanced Physics",
        sourceText: "Precalculus preferred",
        reason: "ambiguous_recommendation"
      })
    ]);
  });
});
