import type { EducationProvider, NearbyCollegeDistrict } from "@/lib/models";

export function collegeDistrictCode(name: string) {
  return `ccc-district-${name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

export function officialInstitutionIconUrl(websiteUrl: string | null | undefined) {
  if (!websiteUrl) return null;
  try {
    const url = new URL(websiteUrl);
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    url.protocol = "https:";
    url.pathname = "/favicon.ico";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

type NearbyProvider = Pick<EducationProvider, "id" | "provider_code" | "district_name" | "name" | "website_url" | "city" | "postal_code"> & {
  distance_miles: number | null;
};

export function groupNearbyCollegeDistricts(providers: NearbyProvider[]): NearbyCollegeDistrict[] {
  const grouped = new Map<string, NearbyCollegeDistrict>();
  for (const provider of providers) {
    if (!provider.district_name) continue;
    const districtCode = collegeDistrictCode(provider.district_name);
    const current = grouped.get(districtCode) ?? {
      district_code: districtCode,
      district_name: provider.district_name,
      colleges_count: 0,
      nearest_distance_miles: null,
      providers: [],
      is_recommended: false
    };
    current.providers.push({
      id: provider.id,
      provider_code: provider.provider_code,
      name: provider.name,
      website_url: provider.website_url,
      city: provider.city,
      postal_code: provider.postal_code,
      distance_miles: provider.distance_miles
    });
    current.colleges_count = current.providers.length;
    if (provider.distance_miles != null && (current.nearest_distance_miles == null || provider.distance_miles < current.nearest_distance_miles)) {
      current.nearest_distance_miles = provider.distance_miles;
    }
    grouped.set(districtCode, current);
  }

  const districts = [...grouped.values()].sort((left, right) => {
    if (left.nearest_distance_miles == null) return right.nearest_distance_miles == null ? left.district_name.localeCompare(right.district_name) : 1;
    if (right.nearest_distance_miles == null) return -1;
    return left.nearest_distance_miles - right.nearest_distance_miles || left.district_name.localeCompare(right.district_name);
  });
  if (districts[0]) districts[0].is_recommended = true;
  return districts;
}
