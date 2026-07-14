import type { SmccdCollege } from "@/lib/models";

export type InstitutionKey = "dtech" | "smccd" | SmccdCollege["code"];

export interface InstitutionIdentity {
  key: InstitutionKey;
  name: string;
  shortName: string;
  lightAsset: string;
  darkAsset: string;
  wideLightAsset?: string;
  wideDarkAsset?: string;
  className: string;
}

export const INSTITUTIONS: Record<InstitutionKey, InstitutionIdentity> = {
  dtech: {
    key: "dtech",
    name: "Design Tech High School",
    shortName: "d.tech",
    lightAsset: "/institutions/dtech-wordmark.png",
    darkAsset: "/institutions/dtech-wordmark.png",
    className: "dtech"
  },
  smccd: {
    key: "smccd",
    name: "San Mateo County Community College District",
    shortName: "SMCCD",
    lightAsset: "/institutions/smccd-blue.svg",
    darkAsset: "/institutions/smccd-white.svg",
    className: "smccd"
  },
  CSM: {
    key: "CSM",
    name: "College of San Mateo",
    shortName: "CSM",
    lightAsset: "/institutions/csm-monogram.jpg",
    darkAsset: "/institutions/csm-monogram.jpg",
    className: "csm"
  },
  SKY: {
    key: "SKY",
    name: "Skyline College",
    shortName: "Skyline",
    lightAsset: "/institutions/skyline-color.png",
    darkAsset: "/institutions/skyline-white.png",
    className: "skyline"
  },
  CAN: {
    key: "CAN",
    name: "Cañada College",
    shortName: "Cañada",
    lightAsset: "/institutions/canada-green.png",
    darkAsset: "/institutions/canada-white.png",
    className: "canada"
  }
};

export function institutionKeyFromName(value: string | null | undefined): InstitutionKey | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized.includes("college of san mateo")) return "CSM";
  if (normalized.includes("skyline college")) return "SKY";
  if (normalized.includes("cañada college") || normalized.includes("canada college")) return "CAN";
  if (normalized.includes("san mateo county community college") || normalized.includes("smccd")) return "smccd";
  if (normalized.includes("design tech") || normalized.includes("d.tech") || normalized.includes("dtech")) return "dtech";
  return null;
}
