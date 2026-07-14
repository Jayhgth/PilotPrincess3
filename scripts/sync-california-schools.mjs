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
  return response.text();
}

function parseDirectory(text) {
  const [headerLine, ...lines] = text.split(/\r?\n/);
  const headers = headerLine.split("\t");
  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  for (const required of ["CDSCode", "StatusType", "School", "GSoffered", "Charter"]) {
    if (column[required] === undefined) throw new Error(`The CDE directory is missing ${required}.`);
  }

  return lines.flatMap((line) => {
    if (!line.trim()) return [];
    const row = line.split("\t");
    const get = (name) => row[column[name]];
    const cdsCode = value(get("CDSCode"));
    const schoolName = value(get("School"));
    const status = value(get("StatusType"))?.toLowerCase();
    const span = gradeSpan(get("GSoffered"));
    if (!cdsCode || !schoolName || cdsCode.endsWith("0000000")) return [];
    if (status !== "active" && status !== "pending") return [];
    if (span.high === null || span.high < 9) return [];

    const isDtech = cdsCode === "41690470129759";
    const isCharter = value(get("Charter")) === "Y";
    const updatedAt = dateValue(get("LastUpDate"));
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
}

const rows = parseDirectory(await readDirectory());
const charterCount = rows.filter((row) => row.governance_type === "charter").length;
console.log(JSON.stringify({ source: sourceFile ?? CDE_DIRECTORY_URL, schools: rows.length, charters: charterCount, dryRun }, null, 2));

if (!dryRun) {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Set SUPABASE_URL (or PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY to sync schools.");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  for (let index = 0; index < rows.length; index += 400) {
    const result = await supabase.from("schools").upsert(rows.slice(index, index + 400), { onConflict: "cds_code" });
    if (result.error) throw result.error;
  }
  console.log(`Synced ${rows.length} active or pending California public high schools.`);
}
