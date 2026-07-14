import { BuildingsIcon as Buildings } from "@phosphor-icons/react";
import { useState } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import { officialInstitutionIconUrl } from "@/lib/college-districts";
import { institutionKeyFromName } from "@/lib/institutions";

interface Props {
  name: string;
  websiteUrl?: string | null;
  kind?: "school" | "college";
  size?: "compact" | "header" | "rail";
  decorative?: boolean;
}

export default function InstitutionIdentityMark({
  name,
  websiteUrl,
  kind = "school",
  size = "compact",
  decorative = false
}: Props) {
  const knownInstitution = institutionKeyFromName(name);
  const [failed, setFailed] = useState(false);
  const iconUrl = officialInstitutionIconUrl(websiteUrl);
  if (knownInstitution) return <InstitutionMark institution={knownInstitution} size={size} decorative={decorative} />;

  const label = `${name} ${kind === "college" ? "college" : "school"} mark`;
  return <span
    className={`institution-identity-mark ${size}`}
    aria-hidden={decorative || undefined}
    aria-label={decorative ? undefined : label}
    role={decorative ? undefined : "img"}
  >
    {iconUrl && !failed
      ? <img src={iconUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      : <Buildings size={size === "header" ? 25 : 19} weight="duotone" aria-hidden />}
  </span>;
}
