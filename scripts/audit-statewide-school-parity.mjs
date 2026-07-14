import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.PUBLIC_SUPABASE_ANON_KEY;
if (!supabaseUrl || (!serviceRoleKey && !anonKey)) throw new Error("Set the Supabase URL and either the service-role or public anon key to audit statewide school parity.");

const supabase = createClient(supabaseUrl, serviceRoleKey ?? anonKey, { auth: { persistSession: false } });
let ephemeralUser = false;
if (!serviceRoleKey) {
  const { data, error } = await supabase.auth.signUp({
    email: `pilot-statewide-audit-${randomUUID()}@example.com`,
    password: `Pp-${randomUUID()}!9a`,
    options: { data: { preferred_name: "Statewide QA" } }
  });
  if (error || !data.session) throw error ?? new Error("The ephemeral statewide audit session could not be created.");
  ephemeralUser = true;
}

async function readAll(table, columns, order) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const query = supabase.from(table).select(columns).order(order, { ascending: true }).range(from, from + 999);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) return rows;
  }
}

function haversineMiles(left, right) {
  const radians = (value) => value * Math.PI / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(left.latitude)) * Math.cos(radians(right.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const [schools, providers, districts] = await Promise.all([
  readAll("schools", "id,slug,name,short_name,website_url,cds_code,district_name,governance_type,status,high_grade,latitude,longitude,directory_source_url", "id"),
  readAll("education_providers", "id,provider_code,provider_type,district_name,district_code,name,website_url,status,latitude,longitude,source_url", "id"),
  readAll("college_districts", "district_code,name,status,source_url", "district_code")
]);

const eligibleSchools = schools.filter((school) => ["active", "pending"].includes(school.status)
  && ["district", "charter"].includes(school.governance_type)
  && Number(school.high_grade ?? 12) >= 9);
const collegeProviders = providers.filter((provider) => provider.status === "active" && provider.provider_type === "community_college");
const districtCodes = new Set(districts.filter((district) => district.status === "active").map((district) => district.district_code));
const errors = [];
const cdsCodes = new Set();

for (const school of eligibleSchools) {
  if (!school.cds_code || !/^\d{14}$/.test(school.cds_code)) errors.push(`${school.name}: invalid CDS code`);
  if (school.cds_code && cdsCodes.has(school.cds_code)) errors.push(`${school.name}: duplicate CDS code ${school.cds_code}`);
  if (school.cds_code) cdsCodes.add(school.cds_code);
  if (!school.directory_source_url) errors.push(`${school.name}: missing CDE directory provenance`);
  if (!school.name || !school.short_name) errors.push(`${school.id}: missing school identity`);
}

for (const provider of collegeProviders) {
  if (!provider.district_name || !provider.district_code || !districtCodes.has(provider.district_code)) errors.push(`${provider.name}: district is not normalized`);
  if (!provider.website_url || !provider.source_url) errors.push(`${provider.name}: missing official identity/provenance`);
}

for (const district of districts.filter((row) => row.status === "active")) {
  if (!collegeProviders.some((provider) => provider.district_code === district.district_code)) errors.push(`${district.name}: district has no active college`);
}

const locatedProviders = collegeProviders.filter((provider) => provider.latitude != null && provider.longitude != null);
let schoolsWithSmartDefault = 0;
const districtSuggestionCounts = new Map();
for (const school of eligibleSchools) {
  if (school.latitude == null || school.longitude == null || locatedProviders.length === 0) {
    const { data, error } = await supabase.rpc("nearby_college_districts", { target_school_id: school.id, result_limit: 1 });
    if (error || !data?.[0]?.district_code) {
      errors.push(`${school.name}: could not derive a college-district default`);
    } else {
      schoolsWithSmartDefault += 1;
      districtSuggestionCounts.set(data[0].district_code, (districtSuggestionCounts.get(data[0].district_code) ?? 0) + 1);
    }
    continue;
  }
  const closest = locatedProviders.reduce((best, provider) => {
    const distance = haversineMiles(school, provider);
    return !best || distance < best.distance ? { provider, distance } : best;
  }, null);
  if (!closest?.provider.district_code) {
    errors.push(`${school.name}: could not derive a college-district default`);
    continue;
  }
  schoolsWithSmartDefault += 1;
  districtSuggestionCounts.set(closest.provider.district_code, (districtSuggestionCounts.get(closest.provider.district_code) ?? 0) + 1);
}

const dtech = eligibleSchools.find((school) => school.slug === "design-tech-high-school");
if (!dtech) errors.push("Design Tech High School is missing from the statewide directory.");
const dtechClosestProvider = dtech?.latitude != null && dtech?.longitude != null
  ? locatedProviders.reduce((best, provider) => {
      const distance = haversineMiles(dtech, provider);
      return !best || distance < best.distance ? { provider, distance } : best;
    }, null)
  : null;
if (dtechClosestProvider?.provider.district_name !== "San Mateo County Community College District") {
  errors.push("d.tech no longer defaults to the San Mateo County Community College District.");
}

const report = {
  schools_checked: eligibleSchools.length,
  public_district_schools: eligibleSchools.filter((school) => school.governance_type === "district").length,
  charter_schools: eligibleSchools.filter((school) => school.governance_type === "charter").length,
  schools_with_official_websites: eligibleSchools.filter((school) => school.website_url).length,
  schools_with_smart_district_defaults: schoolsWithSmartDefault,
  colleges_checked: collegeProviders.length,
  districts_checked: districts.filter((district) => district.status === "active").length,
  districts_suggested_to_at_least_one_school: districtSuggestionCounts.size,
  dtech_default_district: dtechClosestProvider?.provider.district_name ?? null,
  errors: errors.slice(0, 100),
  error_count: errors.length
};
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
if (ephemeralUser) {
  const deletion = await supabase.rpc("delete_current_user_account");
  if (deletion.error) throw deletion.error;
}
