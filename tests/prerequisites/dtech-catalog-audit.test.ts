import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { auditPrerequisiteGraph } from "@/lib/prerequisites";
import type { CatalogCourse, GradeLevel, SourceConfidence } from "@/lib/prerequisites";

const DTECH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "English 2 / English 2 Honors": ["English 2"],
  "English 3 / English 3 Honors": ["English 3"],
  "English 4 / English 4 Honors": ["English 4"],
  "Geometry / Geometry Honors": ["Geometry"],
  "Algebra 2 / Algebra 2-Trigonometry Honors": ["Algebra 2", "Algebra 2 / Trigonometry Honors"]
};

function splitSqlFields(value: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  let bracketDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "'" && quoted && value[index + 1] === "'") {
      current += "''";
      index += 1;
      continue;
    }
    if (character === "'") quoted = !quoted;
    if (!quoted && character === "[") bracketDepth += 1;
    if (!quoted && character === "]") bracketDepth -= 1;
    if (!quoted && bracketDepth === 0 && character === ",") {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  fields.push(current.trim());
  return fields;
}

function sqlString(value: string): string {
  return value.replace(/^'/, "").replace(/'$/, "").replace(/''/g, "'");
}

function sqlArray(value: string): string[] {
  if (/^array\[\]/i.test(value)) return [];
  const contents = value.match(/^array\[(.*)]/i)?.[1] ?? "";
  return contents ? splitSqlFields(contents).map(sqlString) : [];
}

function dtechCatalogFromSeed(): CatalogCourse[] {
  const seed = readFileSync(new URL("../../supabase/seed.sql", import.meta.url), "utf8");
  const section = seed.split("insert into public.courses (")[1]?.split("on conflict (catalog_version_id, name)")[0];
  if (!section) throw new Error("Could not find the d.tech course seed section.");

  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("('") && /\)[,;]?$/.test(line))
    .map((line, index): CatalogCourse => {
      const fields = splitSqlFields(line.replace(/^\(/, "").replace(/\)[,;]?$/, ""));
      const name = sqlString(fields[3]);
      return {
        id: `dtech-seed-${index + 1}`,
        name,
        ...(DTECH_ALIASES[name] ? { aliases: DTECH_ALIASES[name] } : {}),
        gradeLevels: sqlArray(fields[5]).map(Number) as GradeLevel[],
        prerequisites: sqlArray(fields[9]),
        sourceId: sqlString(fields[2]),
        sourceLabel: "Official d.tech course catalog",
        sourceYear: "2025-26",
        confidence: sqlString(fields[13]) as SourceConfidence
      };
    });
}

describe("checked-in d.tech catalog prerequisite audit", () => {
  it("audits every seeded course and leaves only genuinely ambiguous source language unresolved", () => {
    const audit = auditPrerequisiteGraph(dtechCatalogFromSeed());
    const unresolved = audit.issues.filter((issue) => issue.kind === "unresolved_prerequisite");

    expect(audit).toMatchObject({
      courseCount: 41,
      parsedCourseCount: 41,
      referenceCount: 25,
      unresolvedClauseCount: 1
    });
    expect(audit.issues.filter((issue) => issue.kind === "missing_catalog_reference")).toEqual([]);
    expect(audit.issues.filter((issue) => issue.kind === "cycle")).toEqual([]);
    expect(audit.issues.filter((issue) => issue.kind === "impossible_grade_sequence")).toEqual([]);
    expect(unresolved).toEqual([
      expect.objectContaining({
        courseName: "Advanced Physics Honors",
        sourceText: "Precalculus preferred",
        reason: "ambiguous_recommendation"
      })
    ]);
  });
});
