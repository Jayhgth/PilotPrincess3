import { InfoIcon as Info } from "@phosphor-icons/react/dist/csr/Info";
import type { SchoolSupportReadiness } from "@/lib/workspace-bootstrap";

interface Props {
  support: SchoolSupportReadiness;
  schoolName: string;
  onOpenSettings?: () => void;
}

export default function SchoolSupportNotice({ support, schoolName, onOpenSettings }: Props) {
  if (support.level === "complete") return null;
  const available = [
    support.catalog_supported ? "course catalog" : null,
    support.diploma_supported ? "diploma tracking" : null,
    support.planning_supported ? "schedule guidance" : null
  ].filter(Boolean);
  const missing = [
    !support.catalog_supported ? "course catalog" : null,
    !support.diploma_supported ? "diploma tracking" : null,
    !support.planning_supported ? "schedule guidance" : null
  ].filter(Boolean);
  return <aside className="school-support-notice" role="status">
    <Info size={16} weight="fill" aria-hidden />
    <div>
      <strong>{support.level === "discovery" ? `${schoolName} is available for planning setup` : `${schoolName} has partial planning support`}</strong>
      <p>{available.length ? `Available: ${available.join(", ")}. ` : ""}{missing.length ? `Still being verified: ${missing.join(", ")}.` : ""}</p>
      <small>Unverified school data is never treated as an official graduation or scheduling rule.</small>
    </div>
    {onOpenSettings && <button className="quiet-button small" type="button" onClick={onOpenSettings}>School settings</button>}
  </aside>;
}
