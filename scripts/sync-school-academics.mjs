import { createClient } from "@supabase/supabase-js";
import {
  academicAuthorityForSchool,
  academicYearFromSource,
  discoverAcademicAuthorityRoots,
  discoverAcademicSources,
  extractCatalogCourses,
  extractGraduationRequirements,
  mergeOfficialCourses,
  normalizeRequirementArea,
  readAcademicSource,
  ucopCourseValues,
  validateGraduationRequirements
} from "./lib/school-academic-sources.mjs";

const UCOP_ORIGIN = "https://hs-articulation.ucop.edu";
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const discoverOnly = args.includes("--discover-only");
const argument = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const schoolCds = argument("--school-cds");
const schoolName = argument("--school-name");
const maxSchools = args.includes("--all") ? 10_000 : Math.max(1, Number(argument("--limit") ?? 25));
const explicitSource = argument("--source-url");
const CDE_DIRECTORY_URL = "https://www.cde.ca.gov/schooldirectory/report?rid=dl1&tp=txt";

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const key = dryRun || discoverOnly ? process.env.PUBLIC_SUPABASE_ANON_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !key) throw new Error(dryRun || discoverOnly
  ? "PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY are required."
  : "PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for writes.");
const supabase = createClient(supabaseUrl, key, { auth: { persistSession: false } });

async function loadSchools() {
  const rows = [];
  for (let from = 0; rows.length < maxSchools; from += 500) {
    let query = supabase.from("schools").select("*").in("status", ["active", "pending"]).in("governance_type", ["district", "charter"]).order("name").range(from, from + Math.min(499, maxSchools - rows.length - 1));
    if (schoolCds) query = query.eq("cds_code", schoolCds);
    if (schoolName) query = query.ilike("name", `%${schoolName}%`);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < Math.min(500, maxSchools - rows.length + data.length) || schoolCds || schoolName) break;
  }
  return rows.slice(0, maxSchools);
}

async function loadCdeDistrictWebsites() {
  const response = await fetch(CDE_DIRECTORY_URL, { headers: { "user-agent": "PilotPrincess academic authority sync" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) return new Map();
  const [headerLine, ...lines] = (await response.text()).split(/\r?\n/);
  const headers = headerLine.split("\t");
  const cdsIndex = headers.indexOf("CDSCode");
  const websiteIndex = headers.indexOf("WebSite");
  if (cdsIndex < 0 || websiteIndex < 0) return new Map();
  const websites = new Map();
  for (const line of lines) {
    const cells = line.split("\t");
    const cdsCode = String(cells[cdsIndex] ?? "").trim();
    const rawWebsite = String(cells[websiteIndex] ?? "").trim();
    if (!cdsCode.endsWith("0000000") || !rawWebsite || rawWebsite === "No Data") continue;
    websites.set(cdsCode.slice(0, 7), /^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`);
  }
  return websites;
}

async function ucopCourses(school) {
  if (!school.uc_ag_institution_id) return [];
  const response = await fetch(`${UCOP_ORIGIN}/api/public/courselist/institution/${school.uc_ag_institution_id}/list/`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`UCOP course list returned ${response.status}.`);
  const payload = await response.json();
  return Array.isArray(payload.courses) ? payload.courses.map(ucopCourseValues) : [];
}

async function ucopInstitution(school) {
  if (!school.uc_ag_institution_id) return null;
  try {
    const response = await fetch(`${UCOP_ORIGIN}/api/public/institution/${school.uc_ag_institution_id}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    return response.json();
  } catch { return null; }
}

async function ensureSource(school, candidate, source, sourceType, year) {
  const title = candidate?.title || `${school.name} official ${sourceType.replaceAll("_", " ")}`;
  const { data, error } = await supabase.from("school_academic_sources").upsert({
    academic_authority_key: school.academic_authority_key || academicAuthorityForSchool(school),
    school_id: school.id,
    source_type: sourceType,
    title,
    source_url: source.url,
    discovered_from_url: candidate?.discovered_from_url ?? school.district_website_url ?? school.website_url,
    academic_year: year,
    mime_type: source.content_type,
    content_hash: source.content_hash,
    status: "verified",
    last_checked_at: new Date().toISOString()
  }, { onConflict: "academic_authority_key,source_type,source_url" }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function ensureCatalogVersion(school, year, sourceUrl) {
  let { data, error } = await supabase.from("catalog_versions").select("id").eq("school_id", school.id).eq("academic_year", year).maybeSingle();
  if (error) throw error;
  if (data) return data.id;
  const sourceResult = await supabase.from("official_sources").insert({
    school_id: school.id, user_id: null, title: `Official ${school.name} academic sources`, kind: "official_url",
    source_url: sourceUrl, source_year: year, is_official: true, parse_status: "complete", confidence: "verified", document_type: "course_catalog"
  }).select("id").single();
  if (sourceResult.error) throw sourceResult.error;
  const inserted = await supabase.from("catalog_versions").insert({
    school_id: school.id, source_id: sourceResult.data.id, label: `${year} official academic catalog`, academic_year: year, is_current: true, published_at: new Date().toISOString().slice(0, 10)
  }).select("id").single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id;
}

async function publishSchool(school, audit) {
  if (school.slug === "design-tech-high-school") return "preserved_curated";
  const requirementSource = audit.requirement_source;
  const year = audit.academic_year;
  const sourceUrl = audit.course_source?.url ?? requirementSource?.url ?? `${UCOP_ORIGIN}/agcourselist/institution/${school.uc_ag_institution_id}`;
  const catalogVersionId = await ensureCatalogVersion(school, year, sourceUrl);
  if (audit.courses.length) {
    const rows = audit.courses.map((course) => ({ ...course, school_id: school.id, catalog_version_id: catalogVersionId, source_id: null }));
    for (let index = 0; index < rows.length; index += 200) {
      const result = await supabase.from("courses").upsert(rows.slice(index, index + 200), { onConflict: "school_id,external_course_id" });
      if (result.error) throw result.error;
    }
    const existing = await supabase.from("courses").select("id,external_course_id").eq("school_id", school.id).eq("catalog_version_id", catalogVersionId).not("external_course_id", "is", null);
    if (existing.error) throw existing.error;
    const activeExternalIds = new Set(rows.map((row) => row.external_course_id));
    const staleIds = (existing.data ?? []).filter((row) => !activeExternalIds.has(row.external_course_id)).map((row) => row.id);
    for (let index = 0; index < staleIds.length; index += 200) {
      const result = await supabase.from("courses").update({ review_status: "rejected" }).in("id", staleIds.slice(index, index + 200));
      if (result.error) throw result.error;
    }
  }
  if (audit.course_source && audit.course_candidate) {
    await ensureSource(school, audit.course_candidate, audit.course_source, "course_catalog", year);
  }
  if (requirementSource && audit.validation.publishable) {
    await ensureSource(school, audit.requirement_candidate, requirementSource, "graduation_requirements", year);
    const officialSource = await supabase.from("official_sources").select("id").eq("school_id", school.id).eq("source_url", requirementSource.url).maybeSingle();
    let officialSourceId = officialSource.data?.id;
    if (!officialSourceId) {
      const inserted = await supabase.from("official_sources").insert({
        school_id: school.id, user_id: null, title: audit.requirement_candidate?.title || "Official graduation requirements",
        kind: "official_url", source_url: requirementSource.url, raw_text: requirementSource.text.slice(0, 180000), mime_type: requirementSource.content_type,
        source_year: year, is_official: true, parse_status: "complete", confidence: "verified", document_type: "graduation_requirements"
      }).select("id").single();
      if (inserted.error) throw inserted.error;
      officialSourceId = inserted.data.id;
    }
    const requirementRows = audit.requirements.map((row) => ({
      school_id: school.id, catalog_version_id: catalogVersionId, source_id: officialSourceId,
      requirement_key: `${row.area}:${row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      area: row.area, name: row.name, credits_required: row.credits_required, years_required: row.years_required,
      constraint_only: Boolean(row.constraint_only),
      notes: [row.notes, `Source evidence: ${row.evidence}`].filter(Boolean).join(" "), confidence: row.confidence, review_status: "approved"
    }));
    const result = await supabase.from("graduation_requirements").upsert(requirementRows, { onConflict: "catalog_version_id,requirement_key" });
    if (result.error) throw result.error;
    const currentRequirements = await supabase.from("graduation_requirements").select("id,requirement_key").eq("catalog_version_id", catalogVersionId);
    if (currentRequirements.error) throw currentRequirements.error;
    const activeRequirementKeys = new Set(requirementRows.map((row) => row.requirement_key));
    const staleRequirementIds = (currentRequirements.data ?? []).filter((row) => !activeRequirementKeys.has(row.requirement_key)).map((row) => row.id);
    if (staleRequirementIds.length) {
      const staleResult = await supabase.from("graduation_requirements").update({ review_status: "rejected" }).in("id", staleRequirementIds);
      if (staleResult.error) throw staleResult.error;
    }

    const [courseResult, requirementResult] = await Promise.all([
      supabase.from("courses").select("id,uc_ag_area,name,subject").eq("school_id", school.id).eq("catalog_version_id", catalogVersionId).eq("review_status", "approved"),
      supabase.from("graduation_requirements").select("id,area").eq("school_id", school.id).eq("catalog_version_id", catalogVersionId).eq("review_status", "approved")
    ]);
    if (courseResult.error) throw courseResult.error;
    if (requirementResult.error) throw requirementResult.error;
    const requirementIdsByArea = new Map();
    for (const row of requirementResult.data ?? []) requirementIdsByArea.set(row.area, [...(requirementIdsByArea.get(row.area) ?? []), row.id]);
    const requirementByArea = new Map([...requirementIdsByArea].flatMap(([area, ids]) => ids.length === 1 ? [[area, ids[0]]] : []));
    const areaForUc = { a: "social_science", b: "english", c: "math", d: "lab_science", e: "world_language", f: "visual_performing_arts", g: "electives" };
    const mappings = (courseResult.data ?? []).flatMap((course) => {
      const area = areaForUc[String(course.uc_ag_area ?? "").toLowerCase()]
        ?? normalizeRequirementArea(`${course.subject ?? ""} ${course.name ?? ""}`);
      const requirementId = area ? requirementByArea.get(area) : null;
      if (!requirementId) return [];
      return [{ course_id: course.id, requirement_id: requirementId, source_id: officialSourceId, confidence: "verified", is_user_override: false }];
    });
    const currentRequirementIds = (requirementResult.data ?? []).map((row) => row.id);
    if (currentRequirementIds.length) {
      const deleteMappings = await supabase.from("course_requirement_mappings").delete().in("requirement_id", currentRequirementIds).eq("is_user_override", false);
      if (deleteMappings.error) throw deleteMappings.error;
    }
    if (mappings.length) {
      const mappingResult = await supabase.from("course_requirement_mappings").upsert(mappings, { onConflict: "course_id,requirement_id" });
      if (mappingResult.error) throw mappingResult.error;
    }
  }
  return "synced";
}

async function auditSchool(school) {
  const ucopDetails = await ucopInstitution(school);
  const ucopWebsite = ucopDetails?.website
    ? (/^https?:\/\//i.test(ucopDetails.website) ? ucopDetails.website : `https://${ucopDetails.website}`)
    : null;
  const districtWebsite = school.district_website_url ?? districtWebsites.get(String(school.cds_code ?? "").slice(0, 7)) ?? null;
  const baseRoots = [districtWebsite, school.website_url, ucopWebsite].filter(Boolean);
  const linkedAuthorityRoots = school.governance_type === "charter" ? [] : await discoverAcademicAuthorityRoots(baseRoots);
  const roots = [...new Set([...linkedAuthorityRoots, ...baseRoots])];
  const authorityKey = school.academic_authority_key || academicAuthorityForSchool(school);
  const candidates = explicitSource
    ? [{ url: explicitSource, title: "Explicit official academic source", source_type: "combined", score: 100, discovered_from_url: roots[0] ?? explicitSource }]
    : await discoverAcademicSources(roots);
  let authorityAudit = authorityAudits.get(authorityKey);
  if (!authorityAudit) {
    let best = { requirementCandidate: null, requirementSource: null, requirements: [], validation: validateGraduationRequirements([]) };
    for (const candidate of candidates.filter((row) => row.source_type === "graduation_requirements" || row.source_type === "combined").slice(0, 8)) {
      try {
        const source = await readAcademicSource(candidate.url);
        const extracted = extractGraduationRequirements(source.text);
        const validation = validateGraduationRequirements(extracted);
        if (extracted.length > best.requirements.length) best = { requirementCandidate: candidate, requirementSource: source, requirements: extracted, validation };
        if (validation.publishable) break;
      } catch { /* keep the strongest evidence-bearing candidate */ }
    }
    authorityAudit = { candidates, ...best };
    authorityAudits.set(authorityKey, authorityAudit);
  }
  let courseCandidate = null;
  let courseSource = null;
  let catalogCourses = [];
  for (const candidate of candidates.filter((row) => row.source_type === "course_catalog" || row.source_type === "combined").slice(0, 6)) {
    try {
      const source = await readAcademicSource(candidate.url);
      const extracted = extractCatalogCourses(source.text, { sourceUrl: source.url });
      if (extracted.length > catalogCourses.length) {
        courseCandidate = candidate;
        courseSource = source;
        catalogCourses = extracted;
      }
    } catch { /* UCOP remains the verified baseline when a catalog is not machine-readable */ }
  }
  const ucopCourseRows = await ucopCourses(school);
  const courses = mergeOfficialCourses(ucopCourseRows, catalogCourses);
  const academicYear = academicYearFromSource(`${authorityAudit.requirementCandidate?.title ?? ""} ${authorityAudit.requirementCandidate?.url ?? ""}`);
  return {
    school: { id: school.id, name: school.name, cds_code: school.cds_code, academic_authority_key: authorityKey },
    roots,
    academic_year: academicYear,
    sources_discovered: candidates.slice(0, 12),
    course_candidate: courseCandidate,
    course_source: courseSource,
    catalog_course_count: catalogCourses.length,
    ucop_course_count: ucopCourseRows.length,
    requirement_candidate: authorityAudit.requirementCandidate,
    requirement_source: authorityAudit.requirementSource,
    requirements: authorityAudit.requirements,
    validation: authorityAudit.validation,
    courses
  };
}

const schools = await loadSchools();
if (!schools.length) throw new Error("No matching California school was found.");
const authorityAudits = new Map();
const districtWebsites = schools.some((school) => !school.district_website_url) ? await loadCdeDistrictWebsites() : new Map();
const audits = [];
for (const school of schools) {
  try {
    const audit = await auditSchool(school);
    audits.push(audit);
    const publicationMode = !dryRun && !discoverOnly ? await publishSchool(school, audit) : null;
    console.log(JSON.stringify({
      school: audit.school,
      academic_year: audit.academic_year,
      official_course_count: audit.courses.length,
      ucop_course_count: audit.ucop_course_count,
      catalog_course_count: audit.catalog_course_count,
      requirement_source: audit.requirement_source?.url ?? null,
      requirement_count: audit.requirements.length,
      requirement_validation: audit.validation,
      discovered_sources: audit.sources_discovered.length,
      top_sources: audit.sources_discovered.slice(0, 3).map((source) => ({ type: source.source_type, title: source.title, url: source.url })),
      mode: dryRun ? "dry_run" : discoverOnly ? "discover_only" : publicationMode
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ school: school.name, error: error instanceof Error ? error.message : String(error) }));
    if (schoolCds || schoolName) process.exitCode = 1;
  }
}

console.log(`Audited ${audits.length}/${schools.length} schools; ${audits.reduce((sum, audit) => sum + audit.courses.length, 0)} official UCOP course rows; ${audits.filter((audit) => audit.validation.publishable).length} publishable local requirement sets.`);
