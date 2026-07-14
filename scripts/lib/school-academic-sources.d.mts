export interface ExtractedRequirement {
  area: string;
  name: string;
  credits_required: number;
  years_required: number | null;
  notes: string | null;
  constraint_only?: boolean;
  evidence: string;
  confidence: "verified";
}

export function decodeHtmlEntities(value: unknown): string;
export function academicAuthorityForSchool(school: { cds_code?: string | null; governance_type?: string | null; id: string }): string;
export function discoverAcademicAuthorityRoots(rootUrls: string[]): Promise<string[]>;
export function normalizeRequirementArea(title: unknown): string;
export function extractGraduationRequirements(text: unknown): ExtractedRequirement[];
export function extractCatalogCourses(text: unknown, options?: { sourceUrl?: string }): Array<Record<string, unknown>>;
export function mergeOfficialCourses(ucopCourses: Array<Record<string, unknown>>, catalogCourses: Array<Record<string, unknown>>): Array<Record<string, unknown>>;
export function validateGraduationRequirements(requirements: ExtractedRequirement[]): {
  publishable: boolean;
  missing_core_areas: string[];
  duplicate_areas: boolean;
  invalid_rows: string[];
  credits_total: number;
};
export function ucopCourseValues(row: Record<string, unknown>): Record<string, unknown>;
