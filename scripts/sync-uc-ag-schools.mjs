import { createClient } from "@supabase/supabase-js";

const ORIGIN = "https://hs-articulation.ucop.edu";
const SEARCH_URL = `${ORIGIN}/api/public/search/institution`;
const dryRun = process.argv.includes("--dry-run");

function normalize(value) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

function relaxedName(value) {
  return normalize(value).replace(/\b(public|charter|senior|high|school)\b/g, " ").replace(/\s+/g, " ").trim();
}

async function ucSession() {
  const response = await fetch(`${ORIGIN}/agcourselist/results`);
  if (!response.ok) throw new Error(`UCOP A-G directory returned ${response.status}.`);
  const html = await response.text();
  const token = html.match(/name="__RequestVerificationToken"[^>]+value="([^"]+)"/)?.[1];
  if (!token) throw new Error("UCOP A-G anti-forgery token was not found.");
  return token;
}

async function searchPage(token, page) {
  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", RequestVerificationToken: token },
    body: JSON.stringify({
      query: "",
      filters: [{ field: "institutionType.id", selected: "5" }],
      searchType: 2,
      page,
      isReferenceListSearch: false
    })
  });
  if (!response.ok) throw new Error(`UCOP A-G institution page ${page} returned ${response.status}.`);
  return response.json();
}

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

async function loadAllSchools(supabase) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("schools").select("id,name,city,governance_type,status").in("governance_type", ["district", "charter"]).in("status", ["active", "pending"]).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

const token = await ucSession();
const firstPage = await searchPage(token, 1);
const remainingPages = Array.from({ length: Math.max(0, Number(firstPage.totalPages) - 1) }, (_, index) => index + 2);
const pageResults = await mapWithConcurrency(remainingPages, 6, (page) => searchPage(token, page));
const institutions = [firstPage, ...pageResults].flatMap((page) => page.results ?? []).filter((institution) => institution.details?.address?.state === "CA" && !institution.details?.isClosed);

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const key = dryRun ? process.env.PUBLIC_SUPABASE_ANON_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !key) throw new Error(dryRun ? "Public Supabase configuration is required." : "PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const supabase = createClient(supabaseUrl, key, { auth: { persistSession: false } });
const schools = await loadAllSchools(supabase);

function uniqueIndex(rows, keyFor) {
  const grouped = new Map();
  for (const row of rows) {
    const keyValue = keyFor(row);
    if (!keyValue) continue;
    const current = grouped.get(keyValue) ?? [];
    current.push(row);
    grouped.set(keyValue, current);
  }
  return new Map([...grouped].filter(([, matches]) => matches.length === 1).map(([keyValue, matches]) => [keyValue, matches[0]]));
}

const exactInstitutions = uniqueIndex(institutions, (row) => `${normalize(row.name)}|${normalize(row.details?.address?.city)}`);
const relaxedInstitutions = uniqueIndex(institutions, (row) => `${relaxedName(row.name)}|${normalize(row.details?.address?.city)}`);
const exactSchools = uniqueIndex(schools, (row) => `${normalize(row.name)}|${normalize(row.city)}`);
const relaxedSchools = uniqueIndex(schools, (row) => `${relaxedName(row.name)}|${normalize(row.city)}`);
const matches = [];
const matchedSchoolIds = new Set();
for (const [matchKey, school] of exactSchools) {
  const institution = exactInstitutions.get(matchKey);
  if (institution) {
    matches.push({ school, institution, method: "exact_name_city" });
    matchedSchoolIds.add(school.id);
  }
}
for (const [matchKey, school] of relaxedSchools) {
  if (matchedSchoolIds.has(school.id)) continue;
  const institution = relaxedInstitutions.get(matchKey);
  if (institution) matches.push({ school, institution, method: "relaxed_unique_name_city" });
}

if (dryRun) {
  console.log(`UCOP institutions: ${institutions.length}; California public/charter schools: ${schools.length}; unambiguous matches: ${matches.length}.`);
  console.log(matches.slice(0, 5).map(({ school, institution, method }) => ({ school: school.name, ucop: institution.name, city: school.city, method })));
  process.exit(0);
}

const updatedAt = new Date().toISOString();
const updates = await mapWithConcurrency(matches, 12, async ({ school, institution }) => {
  const { error } = await supabase.from("schools").update({
    uc_ag_institution_id: String(institution.id),
    uc_ag_atp_code: institution.details?.atpCode ?? null,
    uc_ag_directory_updated_at: updatedAt
  }).eq("id", school.id);
  if (error) throw error;
  return school.id;
});

console.log(`Linked ${updates.length} California public/charter schools to the official UCOP A-G directory (${institutions.length} active California school lists checked).`);
