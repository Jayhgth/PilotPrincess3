import type { CatalogCourse, CourseReference, PlannedCourseInput } from "./types";

export function normalizeCourseKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

interface IdentityLike {
  id?: string;
  code?: string | null;
  name: string;
  aliases?: readonly string[];
}

export interface CourseMatch {
  matched: boolean;
  matchedBy?: "id" | "code" | "name" | "alias";
}

export function courseIdentityMatch(reference: CourseReference, candidate: IdentityLike): CourseMatch {
  if (reference.id && candidate.id && reference.id === candidate.id) {
    return { matched: true, matchedBy: "id" };
  }

  const referenceCode = reference.code ? normalizeCourseKey(reference.code) : "";
  const candidateCode = candidate.code ? normalizeCourseKey(candidate.code) : "";
  if (referenceCode && candidateCode && referenceCode === candidateCode) {
    return { matched: true, matchedBy: "code" };
  }

  const referenceName = normalizeCourseKey(reference.name);
  const candidateName = normalizeCourseKey(candidate.name);
  if (referenceName && referenceName === candidateName) {
    return { matched: true, matchedBy: "name" };
  }

  const referenceAliases = new Set((reference.aliases ?? []).map(normalizeCourseKey).filter(Boolean));
  const candidateAliases = new Set((candidate.aliases ?? []).map(normalizeCourseKey).filter(Boolean));
  const referenceLabels = new Set([referenceName, referenceCode, ...referenceAliases].filter(Boolean));
  const candidateLabels = new Set([candidateName, candidateCode, ...candidateAliases].filter(Boolean));
  if ([...referenceLabels].some((label) => candidateLabels.has(label))) {
    return { matched: true, matchedBy: "alias" };
  }

  return { matched: false };
}

export function resolveCatalogCourse(
  reference: CourseReference,
  catalog: readonly CatalogCourse[]
): CatalogCourse | undefined {
  return catalog.find((course) => courseIdentityMatch(reference, course).matched);
}

export function referenceFromCatalogCourse(course: CatalogCourse): CourseReference {
  return {
    id: course.id,
    ...(course.code ? { code: course.code } : {}),
    name: course.name,
    ...(course.aliases?.length ? { aliases: [...course.aliases] } : {})
  };
}

export function plannedCourseIdentity(course: PlannedCourseInput): IdentityLike {
  return {
    ...(course.courseId ? { id: course.courseId } : {}),
    code: course.code,
    name: course.name,
    aliases: course.aliases
  };
}
