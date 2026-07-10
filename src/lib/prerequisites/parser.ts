import { normalizeCourseKey, referenceFromCatalogCourse } from "./normalize";
import type {
  AllOfRule,
  CatalogCourse,
  CourseReference,
  CourseRule,
  GradeLevel,
  GradeLevelConstraint,
  GradeLevelRule,
  LetterGrade,
  ParsePrerequisiteOptions,
  ParsedPrerequisites,
  PrerequisiteRule,
  PrerequisiteSourceContext,
  UnresolvedReason,
  UnresolvedRule
} from "./types";

const LETTER_GRADES = new Set<LetterGrade>([
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
  "F"
]);

const AMBIGUOUS_PATTERNS: Array<{
  pattern: RegExp;
  reason: UnresolvedReason;
  explanation: string;
}> = [
  {
    pattern: /\band\s*\/\s*or\b/i,
    reason: "ambiguous_boolean",
    explanation: "The source uses “and/or,” so the required boolean relationship is not explicit."
  },
  {
    pattern: /\b(?:recommended|preferred|strongly encouraged|suggested)\b/i,
    reason: "ambiguous_recommendation",
    explanation: "The source describes a recommendation without saying whether it is required."
  },
  {
    pattern: /\b(?:approval|permission|consent)\b/i,
    reason: "approval_required",
    explanation: "Approval is a manual decision and the source does not encode its criteria."
  },
  {
    pattern: /\b(?:equivalent|equivalency|equivalent experience)\b/i,
    reason: "equivalency_not_defined",
    explanation: "The source allows an equivalency but does not define a deterministic equivalency mapping."
  },
  {
    pattern: /\b(?:placement|assessment|test score|qualifying score|proficiency)\b/i,
    reason: "placement_not_defined",
    explanation: "The source refers to placement or proficiency without a complete deterministic threshold."
  },
  {
    pattern: /\bunless\b/i,
    reason: "unsupported_language",
    explanation: "Exception clauses are not supported because their scope cannot be inferred safely."
  }
];

function sourceContext(text: string, options: ParsePrerequisiteOptions): PrerequisiteSourceContext {
  return {
    originalText: text,
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    ...(options.sourceLabel ? { sourceLabel: options.sourceLabel } : {}),
    ...(options.sourceYear ? { sourceYear: options.sourceYear } : {}),
    confidence: options.confidence ?? "unknown"
  };
}

function unresolvedRule(
  clauseText: string,
  source: PrerequisiteSourceContext,
  reason: UnresolvedReason,
  explanation: string
): UnresolvedRule {
  const question =
    reason === "ambiguous_recommendation"
      ? `Is “${clauseText}” recommended or strictly required, and what satisfies it?`
      : reason === "approval_required"
        ? `Who must approve “${clauseText},” and what criteria will they use?`
        : reason === "equivalency_not_defined"
          ? `Which exact courses or evidence count as the equivalent described by “${clauseText}”?`
          : reason === "placement_not_defined"
            ? `What exact placement result or threshold satisfies “${clauseText}”?`
            : `How should the prerequisite clause “${clauseText}” be interpreted for this plan?`;

  return {
    kind: "unresolved",
    clauseText,
    source,
    reason,
    explanation,
    counselorQuestion: question
  };
}

function asGrade(value: string): LetterGrade | undefined {
  const normalized = value.trim().toUpperCase() as LetterGrade;
  return LETTER_GRADES.has(normalized) ? normalized : undefined;
}

function asGradeLevel(value: string): GradeLevel | undefined {
  const grade = Number(value);
  return grade === 9 || grade === 10 || grade === 11 || grade === 12 ? grade : undefined;
}

function catalogReference(text: string, catalog: readonly CatalogCourse[] | undefined): CourseReference | undefined {
  if (!catalog) return undefined;
  const normalized = normalizeCourseKey(text);
  const match = catalog.find((course) => {
    const labels = [course.id, course.code ?? "", course.name, ...(course.aliases ?? [])];
    return labels.some((label) => normalizeCourseKey(label) === normalized);
  });
  return match ? referenceFromCatalogCourse(match) : undefined;
}

function isPlausibleCourseReference(text: string): boolean {
  if (!text || text.length > 120) return false;
  if (!/^[A-Z0-9]/.test(text)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9 .&+'’/-]*$/.test(text)) return false;
  if (/\b(?:year|years|semester|semesters|credits?|experience|skills?|standing)\b/i.test(text)) return false;
  return true;
}

function courseRule(
  rawCourseName: string,
  clauseText: string,
  source: PrerequisiteSourceContext,
  options: ParsePrerequisiteOptions,
  timing: CourseRule["timing"],
  minimumGrade?: LetterGrade
): PrerequisiteRule {
  const cleaned = rawCourseName
    .trim()
    .replace(/^(?:(?:successful|prior)\s+)?completion of\s+/i, "")
    .replace(/[.;:]$/, "")
    .trim();
  const reference = catalogReference(cleaned, options.catalog);
  if (!reference && !isPlausibleCourseReference(cleaned)) {
    return unresolvedRule(
      clauseText,
      source,
      "unknown_clause",
      "The clause is not an exact known catalog label or a safely recognizable course identifier."
    );
  }
  return {
    kind: "course",
    clauseText,
    source,
    course: reference ?? { name: cleaned },
    timing,
    ...(minimumGrade ? { minimumGrade } : {})
  };
}

function courseRuleWithGrade(
  rawCourseName: string,
  rawGrade: string,
  clauseText: string,
  source: PrerequisiteSourceContext,
  options: ParsePrerequisiteOptions
): PrerequisiteRule {
  const minimumGrade = asGrade(rawGrade);
  if (!minimumGrade) {
    return unresolvedRule(
      clauseText,
      source,
      "unsupported_language",
      `The explicit grade “${rawGrade}” is not a supported letter-grade threshold.`
    );
  }
  return courseRule(rawCourseName, clauseText, source, options, "prior", minimumGrade);
}

function gradeLevelRule(
  clauseText: string,
  source: PrerequisiteSourceContext,
  constraint: GradeLevelConstraint
): GradeLevelRule {
  return { kind: "grade_level", clauseText, source, constraint };
}

function parseGradeLevel(
  clauseText: string,
  source: PrerequisiteSourceContext
): GradeLevelRule | UnresolvedRule | undefined {
  const minimum = clauseText.match(/^(?:students?\s+must\s+be\s+)?(?:in\s+)?(?:grade\s+)?(9|10|11|12)(?:st|nd|rd|th)?\s+grade\s+or\s+(?:higher|above)$/i)
    ?? clauseText.match(/^(?:students?\s+must\s+be\s+)?(?:in\s+)?grade\s+(9|10|11|12)\s+or\s+(?:higher|above)$/i);
  if (minimum) {
    const grade = asGradeLevel(minimum[1]);
    if (grade) return gradeLevelRule(clauseText, source, { kind: "minimum", grade });
  }

  const maximum = clauseText.match(/^(?:students?\s+must\s+be\s+)?(?:in\s+)?grade\s+(9|10|11|12)\s+or\s+(?:lower|below)$/i);
  if (maximum) {
    const grade = asGradeLevel(maximum[1]);
    if (grade) return gradeLevelRule(clauseText, source, { kind: "maximum", grade });
  }

  const range = clauseText.match(/^(?:students?\s+must\s+be\s+)?(?:in\s+)?grades?\s+(9|10|11|12)\s*[-–]\s*(9|10|11|12)$/i);
  if (range) {
    const start = asGradeLevel(range[1]);
    const end = asGradeLevel(range[2]);
    if (start && end && start <= end) {
      const grades = ([9, 10, 11, 12] as GradeLevel[]).filter((grade) => grade >= start && grade <= end);
      return gradeLevelRule(clauseText, source, { kind: "one_of", grades });
    }
  }

  const choices = clauseText.match(/^(?:students?\s+must\s+be\s+)?(?:in\s+)?grade\s+(9|10|11|12)\s+or\s+(9|10|11|12)$/i);
  if (choices) {
    const grades = [asGradeLevel(choices[1]), asGradeLevel(choices[2])].filter(
      (grade): grade is GradeLevel => grade !== undefined
    );
    return gradeLevelRule(clauseText, source, { kind: "one_of", grades });
  }

  if (/\bgrade\b/i.test(clauseText) && /\b(?:higher|lower|above|below)\b/i.test(clauseText)) {
    return unresolvedRule(
      clauseText,
      source,
      "unsupported_language",
      "The grade-level statement does not use a supported grade 9–12 constraint."
    );
  }
  return undefined;
}

function parseClause(
  rawClause: string,
  source: PrerequisiteSourceContext,
  options: ParsePrerequisiteOptions
): PrerequisiteRule {
  const clauseText = rawClause
    .trim()
    .replace(/^prerequisites?\s*:\s*/i, "")
    .replace(/[.;]$/, "")
    .trim();

  if (!clauseText) {
    return unresolvedRule(rawClause, source, "unknown_clause", "The prerequisite clause is empty.");
  }

  const gradeLevel = parseGradeLevel(clauseText, source);
  if (gradeLevel) return gradeLevel;

  for (const ambiguous of AMBIGUOUS_PATTERNS) {
    if (ambiguous.pattern.test(clauseText)) {
      return unresolvedRule(clauseText, source, ambiguous.reason, ambiguous.explanation);
    }
  }

  const coRequisiteSuffix = clauseText.match(/^(.+?)\s+(?:co-?requisite|corequisite)$/i);
  if (coRequisiteSuffix) {
    return courseRule(coRequisiteSuffix[1], clauseText, source, options, "prior_or_concurrent");
  }
  const coRequisitePrefix = clauseText.match(/^(?:co-?requisite|corequisite)\s*:?\s+(.+)$/i);
  if (coRequisitePrefix) {
    return courseRule(coRequisitePrefix[1], clauseText, source, options, "prior_or_concurrent");
  }
  const concurrentEnrollment = clauseText.match(/^concurrent enrollment (?:in|with)\s+(.+)$/i);
  if (concurrentEnrollment) {
    return courseRule(concurrentEnrollment[1], clauseText, source, options, "concurrent");
  }
  const mustBeConcurrent = clauseText.match(/^(.+?)\s+(?:must|may)\s+be taken concurrently$/i);
  if (mustBeConcurrent) {
    return courseRule(mustBeConcurrent[1], clauseText, source, options, "concurrent");
  }

  const gradeSuffix = clauseText.match(
    /^(.+?)\s+with\s+(?:a\s+)?(?:minimum\s+)?grade\s+(?:of\s+)?([A-F][+-]?)\s+or\s+better$/i
  );
  if (gradeSuffix) {
    return courseRuleWithGrade(gradeSuffix[1], gradeSuffix[2], clauseText, source, options);
  }
  const shortGradeSuffix = clauseText.match(/^(.+?)\s+with\s+(?:a\s+)?([A-F][+-]?)\s+or\s+better$/i);
  if (shortGradeSuffix) {
    return courseRuleWithGrade(shortGradeSuffix[1], shortGradeSuffix[2], clauseText, source, options);
  }
  const parentheticalGrade = clauseText.match(/^(.+?)\s*\(minimum grade\s*:?\s*([A-F][+-]?)\)$/i);
  if (parentheticalGrade) {
    return courseRuleWithGrade(parentheticalGrade[1], parentheticalGrade[2], clauseText, source, options);
  }
  const gradePrefix = clauseText.match(
    /^(?:a\s+)?(?:minimum\s+)?grade\s+of\s+([A-F][+-]?)\s+or\s+better\s+in\s+(.+)$/i
  );
  if (gradePrefix) {
    return courseRuleWithGrade(gradePrefix[2], gradePrefix[1], clauseText, source, options);
  }
  if (/\bgrade\b.*\bor\s+better\b/i.test(clauseText)) {
    return unresolvedRule(
      clauseText,
      source,
      "unsupported_language",
      "The grade-minimum wording does not contain a supported A–F letter-grade threshold."
    );
  }

  const withoutCompletionPrefix = clauseText.replace(/^(?:(?:successful|prior)\s+)?completion of\s+/i, "").trim();
  const exactReference = catalogReference(withoutCompletionPrefix, options.catalog);
  if (exactReference) {
    return {
      kind: "course",
      clauseText,
      source,
      course: exactReference,
      timing: "prior"
    };
  }

  if (/[(),;]/.test(withoutCompletionPrefix)) {
    return unresolvedRule(
      clauseText,
      source,
      "unsupported_language",
      "Parenthetical or comma-delimited prerequisite language is not grouped automatically."
    );
  }

  const hasAnd = /\s+and\s+/i.test(withoutCompletionPrefix);
  const hasOr = /\s+or\s+/i.test(withoutCompletionPrefix);
  if (hasAnd && hasOr) {
    return unresolvedRule(
      clauseText,
      source,
      "ambiguous_boolean",
      "The clause mixes AND and OR without explicit grouping."
    );
  }
  if (hasOr) {
    const rules = withoutCompletionPrefix.split(/\s+or\s+/i).map((part) => parseClause(part, source, options));
    return { kind: "any_of", clauseText, source, rules };
  }
  if (hasAnd) {
    const rules = withoutCompletionPrefix.split(/\s+and\s+/i).map((part) => parseClause(part, source, options));
    return { kind: "all_of", clauseText, source, rules };
  }

  return courseRule(withoutCompletionPrefix, clauseText, source, options, "prior");
}

function unresolvedClauses(rule: PrerequisiteRule): UnresolvedRule[] {
  if (rule.kind === "unresolved") return [rule];
  if (rule.kind === "all_of" || rule.kind === "any_of") return rule.rules.flatMap(unresolvedClauses);
  return [];
}

function hasResolvedLeaf(rule: PrerequisiteRule): boolean {
  if (rule.kind === "course" || rule.kind === "grade_level") return true;
  if (rule.kind === "all_of" || rule.kind === "any_of") return rule.rules.some(hasResolvedLeaf);
  return false;
}

export function parsePrerequisites(
  texts: readonly string[],
  options: ParsePrerequisiteOptions = {}
): ParsedPrerequisites {
  const originalTexts = texts.map((text) => text.trim()).filter(Boolean);
  const rules = originalTexts.map((text) => parseClause(text, sourceContext(text, options), options));
  const rootSource = sourceContext(originalTexts.join("; "), options);
  const rule: AllOfRule = {
    kind: "all_of",
    clauseText: originalTexts.join("; "),
    source: rootSource,
    rules
  };
  const unresolved = unresolvedClauses(rule);
  const parseConfidence = unresolved.length === 0 ? "exact" : hasResolvedLeaf(rule) ? "partial" : "unresolved";
  return { rule, parseConfidence, originalTexts, unresolvedClauses: unresolved };
}
