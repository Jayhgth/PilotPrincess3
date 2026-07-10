import { describe, expect, it } from "vitest";
import { institutionKeyFromName } from "@/lib/institutions";

describe("institution identity", () => {
  it.each([
    ["Design Tech High School", "dtech"],
    ["d.tech", "dtech"],
    ["San Mateo County Community College District", "smccd"],
    ["SMCCD concurrent enrollment", "smccd"],
    ["College of San Mateo", "CSM"],
    ["Skyline College", "SKY"],
    ["Cañada College", "CAN"],
    ["Canada College", "CAN"]
  ])("maps %s to %s", (name, expected) => {
    expect(institutionKeyFromName(name)).toBe(expected);
  });

  it("does not infer an institution from unrelated school text", () => {
    expect(institutionKeyFromName("Other high school")).toBeNull();
    expect(institutionKeyFromName(null)).toBeNull();
  });
});
