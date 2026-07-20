import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const CDE_DIRECTORY_URL = "https://www.cde.ca.gov/schooldirectory/report?rid=dl1&tp=txt";
const args = new Set(process.argv.slice(2));
const fileIndex = process.argv.indexOf("--file");
const sourceFile = fileIndex >= 0 ? process.argv[fileIndex + 1] : null;
const dryRun = args.has("--dry-run");

function value(cell) {
  const normalized = String(cell ?? "").trim();
  return !normalized || normalized === "No Data" ? null : normalized;
}

function gradeSpan(raw) {
  const grades = String(raw ?? "")
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
    .filter((grade) => Number.isInteger(grade) && grade >= 0 && grade <= 12);
  return grades.length
    ? { low: Math.min(...grades), high: Math.max(...grades) }
    : { low: null, high: null };
}

function dateValue(raw) {
  const date = value(raw);
  if (!date) return null;
  const parsed = new Date(`${date} 12:00:00 UTC`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function numberValue(raw) {
  const normalized = value(raw);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function websiteValue(raw) {
  const website = value(raw);
  if (!website) return null;
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

async function readDirectory() {
  if (sourceFile) return readFile(sourceFile, "utf8");
  const response = await fetch(CDE_DIRECTORY_URL, { headers: { "user-agent": "PilotPrincess school directory sync" } });
  if (!response.ok) throw new Error(`CDE directory download failed with ${response.status}.`);
  const text = await response.text();
  if (!text.startsWith("CDSCode\t")) {
    throw new Error("CDE did not return its tab-delimited directory (the automated endpoint may require a browser check). Download the official TXT file and rerun with --file <path>.");
  }
  return text;
}

function parseDirectory(text) {
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split("\t");
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  for (const required of ["CDSCode", "StatusType", "School", "GSoffered", "Charter"]) {
    if (column[required] === undefined) throw new Error(`The CDE directory is missing ${required}.`);
  }

  const parsed = lines.filter((line) => line.trim()).map((line) => {
    const row = line.split("\t");
    const get = (name) => row[column[name]];
    return { row, get, cdsCode: value(get("CDSCode")) };
  });
  const districts = new Map(parsed.flatMap(({ get, cdsCode }) => {
    if (!cdsCode?.endsWith("0000000")) return [];
    return [[cdsCode.slice(0, 7), {
      district_cds_code: cdsCode.slice(0, 7),
      district_website_url: websiteValue(get("WebSite")),
      district_directory_source_url: `https://sd.cde.ca.gov/schooldirectory/details?cdscode=${cdsCode}`,
      district_name: value(get("District"))
    }]];
  }));

  const schools = parsed.flatMap(({ get, cdsCode }) => {
    const schoolName = value(get("School"));
    const status = value(get("StatusType"))?.toLowerCase();
    const span = gradeSpan(get("GSoffered"));
    if (!cdsCode || !schoolName || cdsCode.endsWith("0000000")) return [];
    if (status !== "active" && status !== "pending") return [];
    if (span.high === null || span.high < 9) return [];

    const isDtech = cdsCode === "41690470129759";
    const isCharter = value(get("Charter")) === "Y";
    const updatedAt = dateValue(get("LastUpDate"));
    const district = districts.get(cdsCode.slice(0, 7));
    return [{
      cds_code: cdsCode,
      slug: isDtech ? "design-tech-high-school" : `ca-${cdsCode}`,
      name: isDtech ? "Design Tech High School" : schoolName,
      short_name: isDtech ? "d.tech" : schoolName,
      website_url: websiteValue(get("WebSite")),
      source_year: updatedAt?.slice(0, 4) ?? null,
      nces_district_id: value(get("NCESDist")),
      nces_school_id: value(get("NCESSchool")),
      district_name: value(get("District")),
      district_cds_code: cdsCode.slice(0, 7),
      district_website_url: district?.district_website_url ?? null,
      academic_authority_key: isCharter ? `charter:${cdsCode}` : `district:${cdsCode.slice(0, 7)}`,
      county_name: value(get("County")),
      governance_type: isCharter ? "charter" : "district",
      charter_number: value(get("CharterNum")),
      status,
      school_type: value(get("SOCType")),
      low_grade: span.low,
      high_grade: span.high,
      street_address: value(get("StreetAbr")) ?? value(get("Street")),
      city: value(get("City")),
      state_code: value(get("State")) ?? "CA",
      postal_code: value(get("Zip")),
      latitude: numberValue(get("Latitude")),
      longitude: numberValue(get("Longitude")),
      directory_source_url: `https://sd.cde.ca.gov/schooldirectory/details?cdscode=${cdsCode}`,
      directory_updated_at: updatedAt
    }];
  });
  const authorities = new Map();
  for (const school of schools) {
    if (authorities.has(school.academic_authority_key)) continue;
    const district = districts.get(school.district_cds_code);
    authorities.set(school.academic_authority_key, {
      authority_key: school.academic_authority_key,
      authority_type: school.governance_type === "charter" ? "charter" : "district",
      name: school.governance_type === "charter" ? school.name : district?.district_name ?? school.district_name ?? school.name,
      district_cds_code: school.district_cds_code,
      website_url: school.governance_type === "charter" ? school.website_url : school.district_website_url ?? school.website_url,
      source_url: school.governance_type === "charter" ? school.directory_source_url : district?.district_directory_source_url ?? school.directory_source_url,
      source_updated_at: school.directory_updated_at
    });
  }
  return { schools, authorities: [...authorities.values()] };
}

const { schools: rows, authorities } = parseDirectory(await readDirectory());
const charterCount = rows.filter((row) => row.governance_type === "charter").length;
console.log(JSON.stringify({ source: sourceFile ?? CDE_DIRECTORY_URL, schools: rows.length, authorities: authorities.length, charters: charterCount, dryRun }, null, 2));

if (!dryRun) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Set SUPABASE_URL (or PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY to sync schools.");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  for (let index = 0; index < authorities.length; index += 400) {
    const result = await supabase.from("school_academic_authorities").upsert(authorities.slice(index, index + 400), { onConflict: "authority_key" });
    if (result.error) throw result.error;
  }
  for (let index = 0; index < rows.length; index += 400) {
    const result = await supabase.from("schools").upsert(rows.slice(index, index + 400), { onConflict: "cds_code" });
    if (result.error) throw result.error;
  }
  console.log(`Synced ${rows.length} active or pending California public high schools.`);
}
