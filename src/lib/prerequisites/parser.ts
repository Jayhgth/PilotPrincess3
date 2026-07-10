import { normalizeCourseKey, referenceFromCatalogCourse } from "./normalize";
import type {
  AllOfRule,
  CatalogCourse,
  ClearanceRule,
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

function clearanceRule(
  clauseText: string,
  source: PrerequisiteSourceContext,
  clearanceType: ClearanceRule["clearanceType"],
  authorityText: string
): ClearanceRule {
  return { kind: "clearance", clauseText, source, clearanceType, authorityText };
}

function applyMinimumGrade(rule: PrerequisiteRule, minimumGrade: LetterGrade): PrerequisiteRule {
  if (rule.kind === "course") return { ...rule, minimumGrade };
  if (rule.kind === "all_of" || rule.kind === "any_of") {
    return { ...rule, rules: rule.rules.map((child) => applyMinimumGrade(child, minimumGrade)) };
  }
  return rule;
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
  const baseRule = parseClause(rawCourseName, source, options);
  return applyMinimumGrade(baseRule, minimumGrade);
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

  const withoutHistoricalLabel = clauseText
    .replace(/\s*\((?:formerly\s+[^)]+|offered at\s+[^)]+|Skyline|Canada|Cañada)\)/gi, "")
    .trim();
  if (withoutHistoricalLabel !== clauseText) {
    return parseClause(withoutHistoricalLabel, source, options);
  }

  const gradeLevel = parseGradeLevel(clauseText, source);
  if (gradeLevel) return gradeLevel;

  const challengeExplanation = clauseText.match(/^(.+?\.)\s+(.+\bprerequisite challenge\b.+)$/i);
  if (challengeExplanation) {
    const statedOptions = parseClause(challengeExplanation[1].replace(/\.$/, ""), source, options);
    const challenge = clearanceRule(
      challengeExplanation[2],
      source,
      "prerequisite_challenge",
      challengeExplanation[2]
    );
    return { kind: "any_of", clauseText, source, rules: [statedOptions, challenge] };
  }

  if (/^(?:an?\s+)?equivalent(?:\s+(?:course|coursework|experience))?$/i.test(clauseText)) {
    return clearanceRule(clauseText, source, "approved_equivalency", clauseText);
  }
  if (
    /^(?:appropriate\s+)?placement\b|^placement as determined\b|^other measures\b/i.test(clauseText) ||
    /^(?:appropriate\s+skill level\b.*\b(?:eligibility|placement)\b|eligibility for\b|eligible for\b)/i.test(clauseText)
  ) {
    return clearanceRule(clauseText, source, "placement", clauseText);
  }
  if (/^(?:instructor|department|counselor|dean|division)?\s*(?:approval|permission|consent)\b/i.test(clauseText)) {
    return clearanceRule(clauseText, source, "instructor_approval", clauseText);
  }
  if (/^prerequisite challenge\b/i.test(clauseText)) {
    return clearanceRule(clauseText, source, "prerequisite_challenge", clauseText);
  }
  if (/^(?:admission|acceptance|accepted|enrollment|indenture)\s+(?:to|into|in)\b.*\b(?:program|academy|apprenticeship)\b/i.test(clauseText)) {
    return clearanceRule(clauseText, source, "program_admission", clauseText);
  }
  if (/^(?:demonstration\b.*|(?:by\s+)?audition\b.*|portfolio review\b.*|present\b.*portfolio\b.*)$/i.test(clauseText)) {
    return clearanceRule(clauseText, source, "audition_or_portfolio", clauseText);
  }

  for (const ambiguous of AMBIGUOUS_PATTERNS) {
    if (ambiguous.pattern.test(clauseText)) {
      return unresolvedRule(clauseText, source, ambiguous.reason, ambiguous.explanation);
    }
  }

  const priorOrConcurrent = clauseText.match(/^(?:completion(?:\s+of)?|completed)\s+or\s+concurrent enrollment in,?\s+(.+)$/i);
  if (priorOrConcurrent) {
    return parseClause(priorOrConcurrent[1], source, { ...options, defaultTiming: "prior_or_concurrent" });
  }
  const concurrentField = clauseText.match(/^concurrent enrollment in,?\s+(.+)$/i);
  if (concurrentField) {
    return parseClause(concurrentField[1], source, { ...options, defaultTiming: "concurrent" });
  }

  const coRequisiteSuffix = clauseText.match(/^(.+?)\s+(?:co-?requisite|corequisite)$/i);
  if (coRequisiteSuffix) {
    return courseRule(coRequisiteSuffix[1], clauseText, source, options, "prior_or_concurrent");
  }
  const coRequisitePrefix = clauseText.match(/^(?:co-?requisite|corequisite)\s*:?\s+(.+)$/i);
  if (coRequisitePrefix) {
    return courseRule(coRequisitePrefix[1], clauseText, source, options, "prior_or_concurrent");
  }
  const concurrentEnrollment = clauseText.match(/^concurrent enrollment with\s+(.+)$/i);
  if (concurrentEnrollment) {
    return courseRule(concurrentEnrollment[1], clauseText, source, options, "concurrent");
  }
  const mustBeConcurrent = clauseText.match(/^(.+?)\s+(?:must|may)\s+be taken concurrently$/i);
  if (mustBeConcurrent) {
    return courseRule(mustBeConcurrent[1], clauseText, source, options, "concurrent");
  }

  const gradeSuffix = clauseText.match(
    /^(.+?),?\s+with\s+(?:a\s+)?(?:minimum\s+)?grade\s+(?:of\s+)?([A-F][+-]?)\s+or\s+better$/i
  );
  if (gradeSuffix) {
    return courseRuleWithGrade(gradeSuffix[1], gradeSuffix[2], clauseText, source, options);
  }
  const shortGradeSuffix = clauseText.match(/^(.+?),?\s+with\s+(?:a\s+)?([A-F][+-]?)\s+or\s+better$/i);
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
      timing: options.defaultTiming ?? "prior"
    };
  }

  const normalizedBooleans = withoutCompletionPrefix
    .replace(/,\s+or\s+/gi, " or ")
    .replace(/,\s+and\s+/gi, " and ");
  const commaParts = normalizedBooleans.split(/\s*,\s*/).filter(Boolean);
  if (commaParts.length > 1 && commaParts.every((part) => catalogReference(part, options.catalog))) {
    return {
      kind: "all_of",
      clauseText,
      source,
      rules: commaParts.map((part) => parseClause(part, source, options))
    };
  }
  if (/[(),;]/.test(normalizedBooleans)) {
    return unresolvedRule(
      clauseText,
      source,
      "unsupported_language",
      "Parenthetical or comma-delimited prerequisite language is not grouped automatically."
    );
  }

  const hasAnd = /\s+and\s+/i.test(normalizedBooleans);
  const hasOr = /\s+or\s+/i.test(normalizedBooleans);
  if (hasAnd && hasOr) {
    return unresolvedRule(
      clauseText,
      source,
      "ambiguous_boolean",
      "The clause mixes AND and OR without explicit grouping."
    );
  }
  if (hasOr) {
    const rules = normalizedBooleans.split(/\s+or\s+/i).map((part) => parseClause(part, source, options));
    return { kind: "any_of", clauseText, source, rules };
  }
  if (hasAnd) {
    const rules = normalizedBooleans.split(/\s+and\s+/i).map((part) => parseClause(part, source, options));
    return { kind: "all_of", clauseText, source, rules };
  }

  return courseRule(withoutCompletionPrefix, clauseText, source, options, options.defaultTiming ?? "prior");
}

function unresolvedClauses(rule: PrerequisiteRule): UnresolvedRule[] {
  if (rule.kind === "unresolved") return [rule];
  if (rule.kind === "all_of" || rule.kind === "any_of") return rule.rules.flatMap(unresolvedClauses);
  return [];
}

function hasResolvedLeaf(rule: PrerequisiteRule): boolean {
  if (rule.kind === "course" || rule.kind === "clearance" || rule.kind === "grade_level") return true;
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
