import { INSTITUTIONS, type InstitutionKey } from "@/lib/institutions";

export default function InstitutionMark({
  institution,
  size = "compact",
  decorative = false
}: {
  institution: InstitutionKey;
  size?: "compact" | "header" | "rail";
  decorative?: boolean;
}) {
  const identity = INSTITUTIONS[institution];

  return (
    <span
      className={`institution-mark institution-${identity.className} ${size}`}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${identity.name} logo`}
      role={decorative ? undefined : "img"}
    >
      <img className="institution-logo-light" src={identity.lightAsset} alt="" loading="lazy" decoding="async" />
      <img className="institution-logo-dark" src={identity.darkAsset} alt="" loading="lazy" decoding="async" />
    </span>
  );
}
