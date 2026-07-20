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
  const useWideAsset = size !== "compact" && Boolean(identity.wideLightAsset);
  const lightAsset = useWideAsset ? identity.wideLightAsset! : identity.lightAsset;
  const darkAsset = useWideAsset ? identity.wideDarkAsset ?? identity.wideLightAsset! : identity.darkAsset;

  return (
    <span
      className={`institution-mark institution-${identity.className} ${size}`}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${identity.name} logo`}
      role={decorative ? undefined : "img"}
    >
      <img className="institution-logo-light" src={lightAsset} alt="" loading="lazy" decoding="async" />
      <img className="institution-logo-dark" src={darkAsset} alt="" loading="lazy" decoding="async" />
    </span>
  );
}
