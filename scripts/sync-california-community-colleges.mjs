import { createClient } from "@supabase/supabase-js";

const DIRECTORY_URL = "https://www.cccco.edu/Students/Find-a-College/College-Alphabetical-Listing";
const CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const skipGeocoding = args.has("--skip-geocoding");

function decodeHtml(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function providerCode(name) {
  return `ccc-${name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function districtCode(name) {
  return `ccc-district-${name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function normalizeWebsite(url) {
  try {
    const parsed = new URL(url);
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseDirectory(html) {
  const rows = [];
  for (const itemMatch of html.matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
    const item = itemMatch[1];
    const identity = item.match(/^\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
    const district = item.match(/<strong>([\s\S]*?)<\/strong>/i);
    if (!identity || !district || !/community college district|community college/i.test(decodeHtml(district[1]))) continue;
    const afterDistrict = item.slice((district.index ?? 0) + district[0].length).replace(/^\s*(?:<br[^>]*>)?\s*/i, "");
    const detailLines = afterDistrict.split(/<br[^>]*>/i).map(decodeHtml).filter(Boolean);
    const phoneIndex = detailLines.findIndex((line) => /^\d{3}[.\-)]/.test(line));
    const addressLines = detailLines.slice(0, phoneIndex < 0 ? detailLines.length : phoneIndex);
    const name = decodeHtml(identity[2]).replace(/\s+/g, " ");
    const districtName = decodeHtml(district[1]);
    const locationLine = addressLines.at(-1) ?? "";
    const locationMatch = locationLine.match(/^(?:(.*),\s*)?([^,]+?)\s+(\d{5}(?:-\d{4})?)$/);
    if (!locationMatch) throw new Error(`Could not parse the official address for ${name}: ${addressLines.join(", ")}`);
    const streetAddress = addressLines.length > 1 ? addressLines[0] : locationMatch[1];
    if (!streetAddress) throw new Error(`Could not identify the street address for ${name}.`);
    rows.push({
      provider_code: providerCode(name),
      provider_type: "community_college",
      district_name: districtName,
      district_code: districtCode(districtName),
      name: name.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()),
      website_url: normalizeWebsite(identity[1]),
      street_address: streetAddress,
      city: locationMatch[2],
      state_code: "CA",
      postal_code: locationMatch[3].slice(0, 5),
      status: "active",
      source_url: DIRECTORY_URL,
      source_updated_at: new Date().toISOString()
    });
  }
  if (rows.length < 100) throw new Error(`Expected at least 100 colleges from the official directory; found ${rows.length}.`);
  return rows;
}

async function geocode(row) {
  const query = new URLSearchParams({
    address: `${row.street_address}, ${row.city}, CA ${row.postal_code}`,
    benchmark: "Public_AR_Current",
    format: "json"
  });
  const response = await fetch(`${CENSUS_GEOCODER_URL}?${query}`);
  if (!response.ok) return row;
  const payload = await response.json();
  const coordinates = payload?.result?.addressMatches?.[0]?.coordinates;
  return coordinates ? { ...row, longitude: coordinates.x, latitude: coordinates.y } : row;
}

async function mapWithConcurrency(rows, concurrency, transform) {
  const output = new Array(rows.length);
  let index = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (index < rows.length) {
      const current = index++;
      output[current] = await transform(rows[current]);
    }
  }));
  return output;
}

const response = await fetch(DIRECTORY_URL);
if (!response.ok) throw new Error(`Official CCCCO directory returned ${response.status}.`);
let colleges = parseDirectory(await response.text());

if (dryRun) {
  console.log(`Parsed ${colleges.length} official California community colleges.`);
  console.log(colleges.slice(0, 3));
  process.exit(0);
}

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

const districts = [...new Map(colleges.map((college) => [college.district_code, {
  district_code: college.district_code,
  name: college.district_name,
  policy_provider_code: college.district_name === "San Mateo County Community College District" ? "SMCCD" : null,
  status: "active",
  source_url: DIRECTORY_URL,
  source_updated_at: college.source_updated_at
}])).values()];
const districtSync = await supabase.from("college_districts").upsert(districts, { onConflict: "district_code" });
if (districtSync.error) throw districtSync.error;

if (!skipGeocoding) {
  const { data: existing, error } = await supabase.from("education_providers").select("provider_code, latitude, longitude").eq("provider_type", "community_college");
  if (error) throw error;
  const located = new Map((existing ?? []).filter((row) => row.latitude != null && row.longitude != null).map((row) => [row.provider_code, row]));
  colleges = await mapWithConcurrency(colleges, 6, async (row) => {
    const current = located.get(row.provider_code);
    return current ? { ...row, latitude: current.latitude, longitude: current.longitude } : geocode(row);
  });
}

for (let index = 0; index < colleges.length; index += 100) {
  const { error } = await supabase.from("education_providers").upsert(colleges.slice(index, index + 100), { onConflict: "provider_code" });
  if (error) throw error;
}

console.log(`Synced ${colleges.length} official California community colleges in ${districts.length} districts (${colleges.filter((row) => row.latitude != null).length} geocoded).`);
