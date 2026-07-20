import { resolveCatalogCourse } from "./normalize";
import { parsePrerequisites } from "./parser";
import type {
  AuditIssue,
  CatalogCourse,
  CourseRule,
  GradeLevelConstraint,
  ParsedPrerequisites,
  PrerequisiteGraphAudit,
  PrerequisiteRule
} from "./types";

interface GraphEdge {
  from: CatalogCourse;
  to: CatalogCourse;
  rule: CourseRule;
}

function isParsedPrerequisites(value: ParsedPrerequisites | PrerequisiteRule): value is ParsedPrerequisites {
  return "parseConfidence" in value;
}

function isPrerequisiteTextArray(
  value: CatalogCourse["prerequisites"]
): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function ruleForCourse(course: CatalogCourse, catalog: readonly CatalogCourse[]): PrerequisiteRule {
  const prerequisite = course.prerequisites;
  if (!prerequisite || isPrerequisiteTextArray(prerequisite)) {
    return parsePrerequisites(prerequisite ?? [], {
      catalog,
      sourceId: course.sourceId,
      sourceLabel: course.sourceLabel,
      sourceYear: course.sourceYear,
      confidence: course.confidence
    }).rule;
  }
  return isParsedPrerequisites(prerequisite) ? prerequisite.rule : prerequisite;
}

function visitRules(rule: PrerequisiteRule, visitor: (rule: PrerequisiteRule) => void): void {
  visitor(rule);
  if (rule.kind === "all_of" || rule.kind === "any_of") {
    rule.rules.forEach((child) => visitRules(child, visitor));
  }
}

function gradeConstraintPasses(constraint: GradeLevelConstraint, grade: number): boolean {
  if (constraint.kind === "minimum") return grade >= constraint.grade;
  if (constraint.kind === "maximum") return grade <= constraint.grade;
  return constraint.grades.some((allowed) => allowed === grade);
}

function hasFeasibleSequence(edge: GraphEdge): boolean {
  const targetGrades = edge.from.gradeLevels ?? [];
  const prerequisiteGrades = edge.to.gradeLevels ?? [];
  if (targetGrades.length === 0 || prerequisiteGrades.length === 0) return true;
  if (edge.rule.timing === "prior") {
    return targetGrades.some((target) => prerequisiteGrades.some((prerequisite) => prerequisite < target));
  }
  if (edge.rule.timing === "concurrent") {
    return targetGrades.some((target) => prerequisiteGrades.some((prerequisite) => prerequisite === target));
  }
  return targetGrades.some((target) => prerequisiteGrades.some((prerequisite) => prerequisite <= target));
}

function stronglyConnectedComponents(catalog: readonly CatalogCourse[], edges: readonly GraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const course of catalog) adjacency.set(course.id, []);
  for (const edge of edges) adjacency.get(edge.from.id)?.push(edge.to.id);

  let nextIndex = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const connect = (id: string): void => {
    indexes.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex += 1;
    stack.push(id);
    onStack.add(id);

    for (const neighbor of adjacency.get(id) ?? []) {
      if (!indexes.has(neighbor)) {
        connect(neighbor);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(neighbor)!));
      } else if (onStack.has(neighbor)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indexes.get(neighbor)!));
      }
    }

    if (lowLinks.get(id) !== indexes.get(id)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component);
  };

  for (const course of catalog) {
    if (!indexes.has(course.id)) connect(course.id);
  }
  return components;
}

function cycleIssues(catalog: readonly CatalogCourse[], edges: readonly GraphEdge[]): AuditIssue[] {
  const byId = new Map(catalog.map((course) => [course.id, course]));
  return stronglyConnectedComponents(catalog, edges).flatMap((component): AuditIssue[] => {
    const ids = new Set(component);
    const internalEdges = edges.filter((edge) => ids.has(edge.from.id) && ids.has(edge.to.id));
    const selfCycle = component.length === 1 && internalEdges.some((edge) => edge.from.id === edge.to.id);
    if (component.length === 1 && !selfCycle) return [];
    const courses = component.map((id) => byId.get(id)).filter((course): course is CatalogCourse => Boolean(course));
    const includesPriorRequirement = internalEdges.some((edge) => edge.rule.timing === "prior");
    return [
      {
        kind: "cycle",
        severity: includesPriorRequirement ? "error" : "warning",
        courseIds: courses.map((course) => course.id),
        courseNames: courses.map((course) => course.name),
        includesPriorRequirement,
        message: includesPriorRequirement
          ? `Prior-prerequisite cycle detected among ${courses.map((course) => course.name).join(", ")}.`
          : `Co-requisite cycle detected among ${courses.map((course) => course.name).join(", ")}; confirm concurrent enrollment policy.`
      }
    ];
  });
}

function uniqueIssues(issues: AuditIssue[]): AuditIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key =
      issue.kind === "cycle"
        ? `${issue.kind}:${[...issue.courseIds].sort().join(",")}`
        : `${issue.kind}:${issue.courseId}:${issue.sourceText}:${issue.kind === "missing_catalog_reference" ? issue.reference.name : ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function auditPrerequisiteGraph(catalog: readonly CatalogCourse[]): PrerequisiteGraphAudit {
  const issues: AuditIssue[] = [];
  const edges: GraphEdge[] = [];
  let referenceCount = 0;
  let unresolvedClauseCount = 0;

  for (const course of catalog) {
    const root = ruleForCourse(course, catalog);
    visitRules(root, (rule) => {
      if (rule.kind === "unresolved") {
        unresolvedClauseCount += 1;
        issues.push({
          kind: "unresolved_prerequisite",
          severity: "warning",
          courseId: course.id,
          courseName: course.name,
          sourceText: rule.source.originalText,
          reason: rule.reason,
          message: rule.explanation
        });
        return;
      }

      if (rule.kind === "grade_level") {
        const targetGrades = course.gradeLevels ?? [];
        if (targetGrades.length > 0 && !targetGrades.some((grade) => gradeConstraintPasses(rule.constraint, grade))) {
          issues.push({
            kind: "impossible_grade_sequence",
            severity: "error",
            courseId: course.id,
            courseName: course.name,
            sourceText: rule.source.originalText,
            message: `${course.name} is not offered at any grade allowed by “${rule.clauseText}”.`
          });
        }
        return;
      }

      if (rule.kind !== "course") return;
      referenceCount += 1;
      const prerequisite = resolveCatalogCourse(rule.course, catalog);
      if (!prerequisite) {
        issues.push({
          kind: "missing_catalog_reference",
          severity: "error",
          courseId: course.id,
          courseName: course.name,
          reference: rule.course,
          sourceText: rule.source.originalText,
          message: `${course.name} references ${rule.course.name}, which has no exact catalog identifier, code, name, or declared alias.`
        });
        return;
      }
      const edge = { from: course, to: prerequisite, rule };
      edges.push(edge);
      if (!hasFeasibleSequence(edge)) {
        issues.push({
          kind: "impossible_grade_sequence",
          severity: "error",
          courseId: course.id,
          courseName: course.name,
          prerequisiteName: prerequisite.name,
          sourceText: rule.source.originalText,
          message: `${prerequisite.name} cannot occur ${rule.timing === "prior" ? "before" : rule.timing === "concurrent" ? "in the same grade as" : "before or in the same grade as"} ${course.name} using their catalog grade offerings.`
        });
      }
    });
  }

  issues.push(...cycleIssues(catalog, edges));
  return {
    courseCount: catalog.length,
    parsedCourseCount: catalog.filter((course) => course.prerequisites !== undefined).length,
    referenceCount,
    unresolvedClauseCount,
    issues: uniqueIssues(issues)
  };
}
