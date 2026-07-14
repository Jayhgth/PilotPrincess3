import { createClient } from "@supabase/supabase-js";

const ORIGIN = "https://hs-articulation.ucop.edu";
const SOURCE_YEAR = "2026-27";
const sourceTitle = "Official UCOP A-G Course List";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const schoolId = argumentValue("--school-id");
const limit = Number(argumentValue("--limit") ?? 0);
const dryRun = process.argv.includes("--dry-run");

async function mapWithConcurrency(rows, concurrency, transform) {
  const output = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await transform(rows[index], index);
    }
  }));
  return output;
}

async function loadSchools(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from("schools").select("id,name,uc_ag_institution_id").not("uc_ag_institution_id", "is", null).order("name").range(from, from + 999);
    if (schoolId) query = query.eq("id", schoolId);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000 || schoolId) break;
  }
  return limit > 0 ? rows.slice(0, limit) : rows;
}

async function fetchCourseList(school) {
  const response = await fetch(`${ORIGIN}/api/public/courselist/institution/${school.uc_ag_institution_id}/list/`);
  if (!response.ok) throw new Error(`UCOP course list for ${school.name} returned ${response.status}.`);
  const payload = await response.json();
  return { school, payload, courses: Array.isArray(payload.courses) ? payload.courses : [] };
}

function courseValues(row, school, catalogVersionId, sourceId) {
  const semester = Number(row.courseLengthId) === 1;
  return {
    school_id: school.id,
    catalog_version_id: catalogVersionId,
    source_id: sourceId,
    course_code: row.transcriptAbbreviations || row.recordId || null,
    name: String(row.title).trim(),
    subject: row.disciplineName || `A-G area ${String(row.subjectAreaCode).toUpperCase()}`,
    course_type: "uc_ag_approved",
    grade_levels: [],
    credits: semester ? 5 : 10,
    college_units: null,
    term_type: semester ? "semester" : "year",
    uc_ag_area: String(row.subjectAreaCode).toLowerCase(),
    prerequisites: [],
    description: "UC A-G approved course. School offering grade, prerequisites, and schedule require local catalog verification.",
    is_honors: Number(row.isHonors) === 1,
    is_weighted: Number(row.isHonors) === 1,
    confidence: "verified",
    review_status: "approved"
  };
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const key = dryRun ? process.env.PUBLIC_SUPABASE_ANON_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !key) throw new Error(dryRun ? "Public Supabase configuration is required." : "PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const supabase = createClient(supabaseUrl, key, { auth: { persistSession: false } });
const schools = await loadSchools(supabase);
const lists = await mapWithConcurrency(schools, 8, fetchCourseList);
const available = lists.filter((item) => item.courses.length > 0);

if (dryRun) {
  console.log(`Read ${available.length} non-empty UCOP course lists with ${available.reduce((sum, item) => sum + item.courses.length, 0)} A-G course records.`);
  console.log(available.slice(0, 3).map((item) => ({ school: item.school.name, courses: item.courses.length })));
  process.exit(0);
}

const frameworkResult = await supabase.from("academic_frameworks").select("id").eq("framework_type", "uc_ag").eq("jurisdiction_key", "university-of-california").eq("status", "published").single();
if (frameworkResult.error) throw frameworkResult.error;
const ucFrameworkId = frameworkResult.data.id;
const ruleResult = await supabase.from("academic_requirement_rules").select("id,rule_key").eq("framework_id", ucFrameworkId);
if (ruleResult.error) throw ruleResult.error;
const ruleByArea = new Map((ruleResult.data ?? []).map((rule) => [rule.rule_key.toLowerCase(), rule.id]));

let importedCourses = 0;
let mappedCourses = 0;
await mapWithConcurrency(available, 4, async ({ school, courses }) => {
  const sourceUrl = `${ORIGIN}/agcourselist/institution/${school.uc_ag_institution_id}`;
  let sourceResult = await supabase.from("official_sources").select("id").eq("school_id", school.id).is("user_id", null).eq("source_url", sourceUrl).maybeSingle();
  if (sourceResult.error) throw sourceResult.error;
  let sourceId = sourceResult.data?.id;
  if (!sourceId) {
    const inserted = await supabase.from("official_sources").insert({
      school_id: school.id, user_id: null, title: sourceTitle, kind: "official_url",
      source_url: sourceUrl, storage_path: null, raw_text: null, mime_type: "application/json",
      source_year: SOURCE_YEAR, is_official: true, parse_status: "complete", confidence: "verified", document_type: "general"
    }).select("id").single();
    if (inserted.error) throw inserted.error;
    sourceId = inserted.data.id;
  }

  const versionResult = await supabase.from("catalog_versions").select("id,is_current").eq("school_id", school.id).eq("academic_year", SOURCE_YEAR).maybeSingle();
  if (versionResult.error) throw versionResult.error;
  let catalogVersionId = versionResult.data?.id;
  if (!catalogVersionId) {
    const currentResult = await supabase.from("catalog_versions").select("id").eq("school_id", school.id).eq("is_current", true).limit(1);
    if (currentResult.error) throw currentResult.error;
    const inserted = await supabase.from("catalog_versions").insert({
      school_id: school.id, source_id: sourceId, label: "UCOP A-G approved courses",
      academic_year: SOURCE_YEAR, is_current: (currentResult.data ?? []).length === 0, published_at: new Date().toISOString().slice(0, 10)
    }).select("id").single();
    if (inserted.error) throw inserted.error;
    catalogVersionId = inserted.data.id;
  }

  const existingResult = await supabase.from("courses").select("id,name").eq("school_id", school.id);
  if (existingResult.error) throw existingResult.error;
  const existingByName = new Map((existingResult.data ?? []).map((row) => [row.name.toLowerCase(), row]));
  const missingByName = new Map();
  for (const row of courses) {
    const normalizedTitle = String(row.title).trim().toLowerCase();
    if (!existingByName.has(normalizedTitle) && !missingByName.has(normalizedTitle)) missingByName.set(normalizedTitle, courseValues(row, school, catalogVersionId, sourceId));
  }
  const missing = [...missingByName.values()];
  if (missing.length) {
    const inserted = await supabase.from("courses").insert(missing).select("id,name");
    if (inserted.error) throw inserted.error;
    for (const row of inserted.data ?? []) existingByName.set(row.name.toLowerCase(), row);
    importedCourses += missing.length;
  }

  const mappingByKey = new Map();
  for (const row of courses) {
    const course = existingByName.get(String(row.title).trim().toLowerCase());
    const requirementRuleId = ruleByArea.get(String(row.subjectAreaCode).toLowerCase());
    if (course && requirementRuleId) mappingByKey.set(`${course.id}:${requirementRuleId}`, {
      course_id: course.id, framework_id: ucFrameworkId, requirement_rule_id: requirementRuleId,
      source_url: sourceUrl, confidence: "verified", review_status: "approved"
    });
  }
  const mappings = [...mappingByKey.values()];
  if (mappings.length) {
    const mappingResult = await supabase.from("course_framework_mappings").upsert(mappings, { onConflict: "course_id,framework_id,requirement_rule_id" });
    if (mappingResult.error) throw mappingResult.error;
    mappedCourses += mappings.length;
  }

  const honorByCourse = new Map();
  for (const row of courses.filter((candidate) => Number(candidate.isHonors) === 1)) {
    const course = existingByName.get(String(row.title).trim().toLowerCase());
    if (course) honorByCourse.set(course.id, { course_id: course.id, designation: "uc_honors", source_url: sourceUrl, source_year: SOURCE_YEAR, confidence: "verified", review_status: "approved" });
  }
  const honors = [...honorByCourse.values()];
  if (honors.length) {
    const designationResult = await supabase.from("course_designations").upsert(honors, { onConflict: "course_id,designation" });
    if (designationResult.error) throw designationResult.error;
  }
});

console.log(`Synced ${available.length} UCOP A-G course lists: ${importedCourses} new catalog rows and ${mappedCourses} approved framework mappings.`);
