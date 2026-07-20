export interface CollegeProviderCapabilities {
  catalog: boolean;
  prerequisites: boolean;
  degrees: boolean;
  generalEducation: boolean;
  enrollmentPolicy: boolean;
}

export interface CollegeProviderAdapter {
  providerCode: string;
  districtCodes: readonly string[];
  label: string;
  capabilities: CollegeProviderCapabilities;
}

const IDENTITY_ONLY: CollegeProviderCapabilities = {
  catalog: false,
  prerequisites: false,
  degrees: false,
  generalEducation: false,
  enrollmentPolicy: false
};

export const COLLEGE_PROVIDER_ADAPTERS: readonly CollegeProviderAdapter[] = [
  {
    providerCode: "SMCCD",
    districtCodes: ["SMCCD"],
    label: "San Mateo County Community College District",
    capabilities: {
      catalog: true,
      prerequisites: true,
      degrees: true,
      generalEducation: true,
      enrollmentPolicy: true
    }
  }
];

export function collegeProviderAdapter(providerCode: string | null | undefined): CollegeProviderAdapter {
  return COLLEGE_PROVIDER_ADAPTERS.find((adapter) => adapter.providerCode === providerCode)
    ?? {
      providerCode: providerCode ?? "unselected",
      districtCodes: providerCode ? [providerCode] : [],
      label: "Selected California community-college district",
      capabilities: IDENTITY_ONLY
    };
}
