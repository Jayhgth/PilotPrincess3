import { Menu } from "@base-ui/react/menu";
import { CaretDownIcon as CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon as Check } from "@phosphor-icons/react/dist/csr/Check";
import { CopyIcon as Copy } from "@phosphor-icons/react/dist/csr/Copy";
import { DotsThreeIcon as DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree";
import { GitDiffIcon as GitDiff } from "@phosphor-icons/react/dist/csr/GitDiff";
import { PencilSimpleIcon as PencilSimple } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon as Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { SortAscendingIcon as SortAscending } from "@phosphor-icons/react/dist/csr/SortAscending";
import { TrashIcon as Trash } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon as X } from "@phosphor-icons/react/dist/csr/X";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { COLLEGE_COURSE_SELECT, COLLEGE_DATA } from "@/lib/college-provider-contract";
import type {
  Course,
  CourseRequirementMapping,
  GraduationRequirement,
  PlanCourse,
  PlanVersion,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSmccdGeCompletion,
  StudentSmccdGoal
} from "@/lib/models";
import {
  planVersionMetrics,
  planVersionDifferences,
  planVersionDisplayLabel,
  planVersionRole,
  planVersionStrategy,
  PLAN_STRATEGY_LABELS,
  type PlanStrategy,
  type PlanVersionDifference,
  type PlanVersionMetrics,
  type PlanVersionSummary
} from "@/lib/plan-versions";
import {
  activateOwnedPlanVersion,
  archiveOwnedPlanVersion,
  cachedOwnedPlanVersions,
  createOwnedPlanVersion,
  listOwnedPlanVersions,
  renameOwnedPlanVersion,
  restoreOwnedPlanVersion
} from "@/lib/plan-version-store";

interface Props {
  supabase: SupabaseClient;
  userId: string;
  activeVersion: PlanVersion;
  courses: Course[];
  requirements: GraduationRequirement[];
  mappings: CourseRequirementMapping[];
  equivalencies: SmccdHighSchoolEquivalency[];
  goals: StudentSmccdGoal[];
  programs: SmccdProgram[];
  degreeRequirements: SmccdProgramRequirement[];
  degreeRequirementCourses: SmccdRequirementCourse[];
  manualCompletions: StudentSmccdGeCompletion[];
  refreshToken: number;
  onSort: () => void;
  sortDisabled: boolean;
  onActiveVersionChanged: (version: PlanVersion) => Promise<void>;
}

type DialogMode = "create" | "rename" | "compare" | null;

function parseVersionList(value: unknown): PlanVersionSummary[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is PlanVersionSummary => Boolean(row) && typeof row === "object" && !Array.isArray(row));
}

function readableError(caught: unknown, fallback: string) {
  if (caught instanceof Error && caught.message) return caught.message;
  if (caught && typeof caught === "object" && "message" in caught && typeof caught.message === "string") return caught.message;
  return fallback;
}

function MetricValue({ value, suffix = "" }: { value: number | null; suffix?: string }) {
  return <strong>{value === null ? "—" : `${value}${suffix}`}</strong>;
}

export default function PlanVersionManager({
  supabase,
  userId,
  activeVersion,
  courses,
  requirements,
  mappings,
  equivalencies,
  goals,
  programs,
  degreeRequirements,
  degreeRequirementCourses,
  manualCompletions,
  refreshToken,
  onSort,
  sortDisabled,
  onActiveVersionChanged
}: Props) {
  const [versions, setVersions] = useState<PlanVersionSummary[]>(() => cachedOwnedPlanVersions(activeVersion.plan_id) ?? []);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [label, setLabel] = useState("");
  const [startEmpty, setStartEmpty] = useState(false);
  const [strategy, setStrategy] = useState<PlanStrategy>("balanced");
  const [compareVersionId, setCompareVersionId] = useState("");
  const [comparison, setComparison] = useState<Record<string, PlanVersionMetrics> | null>(null);
  const [differences, setDifferences] = useState<PlanVersionDifference[]>([]);
  const [selectedMergeIds, setSelectedMergeIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    restoreId?: string;
    mergeUndo?: { insertedIds: string[]; previousRows: Array<Record<string, unknown>> };
  } | null>(null);
  const [confirmingArchiveId, setConfirmingArchiveId] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmingArchiveId) return;
    const timeout = window.setTimeout(() => setConfirmingArchiveId(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [confirmingArchiveId]);

  const fetchVersions = useCallback(async () =>
    parseVersionList(await listOwnedPlanVersions(supabase, userId, activeVersion)),
  [activeVersion, supabase, userId]);

  const applyVersions = useCallback((loaded: PlanVersionSummary[]) => {
    setVersions(loaded);
    setError(null);
    setCompareVersionId((current) => loaded.some((version) => version.id === current && current !== activeVersion.id)
      ? current
      : loaded.find((version) => version.id !== activeVersion.id && planVersionRole(version) === "plan")?.id
        ?? loaded.find((version) => version.id !== activeVersion.id)?.id
        ?? "");
  }, [activeVersion.id]);

  const loadVersions = useCallback(async () => {
    applyVersions(await fetchVersions());
  }, [applyVersions, fetchVersions]);

  useEffect(() => {
    let active = true;
    void fetchVersions().then((loaded) => {
      if (active) applyVersions(loaded);
    }).catch((caught) => {
      if (active) setError(readableError(caught, "Plans could not be loaded."));
    });
    return () => { active = false; };
  }, [applyVersions, fetchVersions, refreshToken]);

  const scopedVersions = versions.filter((version) => version.plan_id === activeVersion.plan_id);
  const active = scopedVersions.find((version) => version.id === activeVersion.id) ?? ({
    ...activeVersion,
    label: planVersionDisplayLabel(activeVersion),
    course_count: 0,
    updated_at: activeVersion.created_at,
    archived_at: null
  } as PlanVersionSummary);
  // The active workspace is always a real, selectable plan, including accounts
  // created before named plan versions were introduced. Keep it in the picker
  // even when the lifecycle RPC or legacy metadata has not been deployed yet.
  const selectablePlans = [
    active,
    ...scopedVersions.filter((version) => version.id !== active.id && planVersionRole(version) === "plan")
  ];
  const backups = scopedVersions.filter((version) => planVersionRole(version) === "backup" && version.id !== activeVersion.id).slice(0, 10);
  const compareTarget = scopedVersions.find((version) => version.id === compareVersionId) ?? null;
  const canCompare = scopedVersions.some((version) => version.id !== activeVersion.id);

  async function activate(versionId: string) {
    if (!versionId || versionId === activeVersion.id) return;
    setBusy("switch");
    setError(null);
    try {
      const activated = await activateOwnedPlanVersion(supabase, userId, activeVersion, versionId);
      await onActiveVersionChanged(activated as unknown as PlanVersion);
      setNotice({ message: "Plan switched." });
    } catch (caught) {
      setError(readableError(caught, "The plan could not be opened."));
    } finally {
      setBusy(null);
    }
  }

  async function createVersion() {
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    setBusy("create");
    setError(null);
    try {
      const created = await createOwnedPlanVersion(supabase, {
        userId,
        activeVersion,
        label: cleanLabel,
        sourceVersionId: activeVersion.id,
        activate: true,
        startEmpty,
        role: "plan",
        strategy
      });
      setDialogMode(null);
      setLabel("");
      setStartEmpty(false);
      setStrategy("balanced");
      await onActiveVersionChanged(created as unknown as PlanVersion);
      setNotice({ message: `Created and opened “${cleanLabel}”.` });
    } catch (caught) {
      setError(readableError(caught, "The plan could not be created."));
    } finally {
      setBusy(null);
    }
  }

  async function renameVersion() {
    const cleanLabel = label.trim();
    if (!cleanLabel) return;
    setBusy("rename");
    setError(null);
    try {
      await renameOwnedPlanVersion(supabase, userId, activeVersion.id, cleanLabel);
      setDialogMode(null);
      setLabel("");
      await loadVersions();
      setNotice({ message: `Renamed this plan to “${cleanLabel}”.` });
    } catch (caught) {
      setError(readableError(caught, "The plan could not be renamed."));
    } finally {
      setBusy(null);
    }
  }

  async function archiveVersion(version: PlanVersionSummary) {
    if (confirmingArchiveId !== version.id) {
      setConfirmingArchiveId(version.id);
      return;
    }
    setConfirmingArchiveId(null);
    setBusy(`archive:${version.id}`);
    setError(null);
    try {
      await archiveOwnedPlanVersion(supabase, userId, version.id);
      await loadVersions();
      setNotice({ message: `Deleted “${version.label}”.`, restoreId: version.id });
    } catch (caught) {
      setError(readableError(caught, "The plan could not be deleted."));
    } finally {
      setBusy(null);
    }
  }

  async function restoreArchived(versionId: string) {
    setBusy("restore");
    try {
      await restoreOwnedPlanVersion(supabase, userId, versionId);
      await loadVersions();
      setNotice({ message: "Plan restored." });
    } catch (caught) {
      setError(readableError(caught, "The plan could not be restored."));
    } finally {
      setBusy(null);
    }
  }

  async function loadComparison(targetVersionId = compareVersionId) {
    const targetVersion = scopedVersions.find((version) => version.id === targetVersionId) ?? null;
    if (!targetVersion) return;
    setBusy("compare");
    setError(null);
    try {
      const ids = [activeVersion.id, targetVersion.id];
      const planResult = await supabase.from("plan_courses").select("*")
        .eq("user_id", userId).in("plan_version_id", ids)
        .order("grade_level").order("sort_order");
      if (planResult.error) throw planResult.error;
      const rows = (planResult.data ?? []) as unknown as PlanCourse[];
      const collegeIds = [...new Set(rows.map((row) => row.smccd_course_id).filter((id): id is string => Boolean(id)))];
      const collegeResult = collegeIds.length
        ? await supabase.from(COLLEGE_DATA.courses).select(COLLEGE_COURSE_SELECT).in("id", collegeIds)
        : { data: [], error: null };
      if (collegeResult.error) throw collegeResult.error;
      const collegeCourses = (collegeResult.data ?? []) as unknown as SmccdCourse[];
      setComparison(Object.fromEntries(ids.map((versionId) => [versionId, planVersionMetrics({
        rows: rows.filter((row) => row.plan_version_id === versionId),
        courses,
        requirements,
        mappings,
        equivalencies,
        collegeCourses,
        goals,
        programs,
        degreeRequirements,
        degreeRequirementCourses,
        manualCompletions
      })])));
      const planDifferences = planVersionDifferences({
        baseRows: rows.filter((row) => row.plan_version_id === activeVersion.id),
        targetRows: rows.filter((row) => row.plan_version_id === targetVersion.id),
        courses,
        collegeCourses
      });
      setDifferences(planDifferences);
      setSelectedMergeIds(new Set(planDifferences.filter((item) => item.kind !== "removed").map((item) => item.sourceCourseId)));
      setCompareVersionId(targetVersion.id);
      setDialogMode("compare");
    } catch (caught) {
      setError(readableError(caught, "The plans could not be compared."));
    } finally {
      setBusy(null);
    }
  }

  async function mergeSelectedCourses() {
    if (!compareTarget || selectedMergeIds.size === 0) return;
    setBusy("merge");
    setError(null);
    try {
      const result = await supabase.rpc("merge_plan_version_courses_v1", {
        p_source_version_id: compareTarget.id,
        p_target_version_id: activeVersion.id,
        p_source_course_ids: [...selectedMergeIds]
      });
      if (result.error) throw result.error;
      const changed = result.data && typeof result.data === "object" && !Array.isArray(result.data) && "changed_count" in result.data
        ? Number((result.data as { changed_count?: unknown }).changed_count ?? selectedMergeIds.size)
        : selectedMergeIds.size;
      const payload = result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? result.data as Record<string, unknown>
        : {};
      const insertedIds = Array.isArray(payload.inserted_ids) ? payload.inserted_ids.filter((id): id is string => typeof id === "string") : [];
      const previousRows = Array.isArray(payload.previous_rows)
        ? payload.previous_rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
        : [];
      setDialogMode(null);
      setNotice({
        message: `${changed} ${changed === 1 ? "course was" : "courses were"} merged into ${active.label}.`,
        mergeUndo: { insertedIds, previousRows }
      });
      await onActiveVersionChanged(activeVersion);
      await loadVersions();
    } catch (caught) {
      setError(readableError(caught, "The selected courses could not be merged."));
    } finally {
      setBusy(null);
    }
  }

  async function undoMerge() {
    if (!notice?.mergeUndo) return;
    setBusy("undo-merge");
    setError(null);
    try {
      if (notice.mergeUndo.insertedIds.length) {
        const removal = await supabase.from("plan_courses").delete().eq("user_id", userId).in("id", notice.mergeUndo.insertedIds);
        if (removal.error) throw removal.error;
      }
      if (notice.mergeUndo.previousRows.length) {
        const restoration = await supabase.from("plan_courses").upsert(notice.mergeUndo.previousRows);
        if (restoration.error) throw restoration.error;
      }
      setNotice({ message: "Plan merge undone." });
      await onActiveVersionChanged(activeVersion);
      await loadVersions();
    } catch (caught) {
      setError(readableError(caught, "The plan merge could not be undone."));
    } finally {
      setBusy(null);
    }
  }

  const comparisonRows = useMemo(() => [
    { label: "Diploma coverage", key: "diplomaPercent" as const, suffix: "%" },
    { label: "Fit for bookmarked majors", key: "majorFitPercent" as const, suffix: "%" },
    { label: "Projected weighted GPA", key: "projectedWeightedGpa" as const, suffix: "" },
    { label: "Courses", key: "courseCount" as const, suffix: "" },
    { label: "Peak college units", key: "peakCollegeUnits" as const, suffix: "" }
  ], []);

  return <>
    <div className="plan-version-bar" aria-label="Four-year plans">
      <div className="plan-version-field">
        <span className="plan-version-label"><span>Plan</span><span>{active.course_count} {active.course_count === 1 ? "course" : "courses"}</span></span>
        <Menu.Root modal={false} disabled={Boolean(busy)} onOpenChange={(open) => { if (!open) setConfirmingArchiveId(null); }}>
          <Menu.Trigger className="plan-version-trigger" aria-label={`Plan: ${active.label}`}>
            <span>{active.label}</span><CaretDown size={14} aria-hidden />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner className="plan-version-positioner" side="bottom" align="start" sideOffset={5} collisionPadding={10}>
              <Menu.Popup className="plan-version-popup">
                <div className="plan-version-popup-heading">Plans</div>
                {selectablePlans.map((version) => <div className="plan-version-option" key={version.id}>
                  <Menu.Item className="plan-version-option-open" closeOnClick onClick={() => void activate(version.id)}>
                    <span className="plan-version-option-check">{version.id === active.id && <Check size={14} weight="bold" />}</span>
                    <span><strong>{version.label}</strong><small>{version.course_count} {version.course_count === 1 ? "course" : "courses"} · {PLAN_STRATEGY_LABELS[planVersionStrategy(version)]}</small></span>
                  </Menu.Item>
                  {version.id !== active.id && <Menu.Item
                    className={`plan-version-option-delete ${confirmingArchiveId === version.id ? "confirm" : ""}`}
                    closeOnClick={false}
                    onClick={() => void archiveVersion(version)}
                    disabled={Boolean(busy)}
                    aria-label={confirmingArchiveId === version.id ? `Confirm deletion of ${version.label}` : `Delete ${version.label}`}
                    title={confirmingArchiveId === version.id ? "Click again to delete" : `Delete ${version.label}`}
                  ><Trash size={15} /><span>{confirmingArchiveId === version.id ? "Confirm" : "Delete"}</span></Menu.Item>}
                </div>)}
                {backups.length > 0 && <><div className="plan-version-popup-heading backup">Recent backups</div>{backups.map((version) => <Menu.Item className="plan-version-backup" onClick={() => void activate(version.id)} key={version.id}>{version.label}</Menu.Item>)}</>}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
      <div className="plan-version-actions">
        <button className="secondary-button small" type="button" onClick={() => { setLabel(""); setStartEmpty(false); setStrategy("balanced"); setDialogMode("create"); }}><Plus size={15} /> New plan</button>
        <button className="secondary-button small" type="button" onClick={() => void loadComparison()} disabled={!canCompare || Boolean(busy)}><GitDiff size={15} /> Compare</button>
        <button className="secondary-button small" type="button" onClick={onSort} disabled={sortDisabled || Boolean(busy)} title="Sort every grade with college courses first and pass/fail courses last"><SortAscending size={15} /> Sort courses</button>
        <details className="plan-version-menu">
          <summary aria-label="Plan actions"><DotsThree size={18} weight="bold" /></summary>
          <div>
            <button type="button" onClick={() => { setLabel(active.label); setDialogMode("rename"); }}><PencilSimple size={15} /> Rename</button>
            <button type="button" onClick={() => { setLabel(`${active.label} copy`); setStartEmpty(false); setStrategy(planVersionStrategy(active)); setDialogMode("create"); }}><Copy size={15} /> Duplicate</button>
          </div>
        </details>
      </div>
    </div>
    {error && <p className="plan-version-message error" role="alert">{error}</p>}
    {notice && <p className="plan-version-message" role="status">{notice.message}{notice.restoreId && <button type="button" onClick={() => void restoreArchived(notice.restoreId!)} disabled={busy === "restore"}>Undo</button>}{notice.mergeUndo && <button type="button" onClick={() => void undoMerge()} disabled={busy === "undo-merge"}>Undo</button>}</p>}

    {dialogMode === "create" && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogMode(null); }}>
      <section className="plan-version-dialog" role="dialog" aria-modal="true" aria-labelledby="new-plan-title">
        <header><h2 id="new-plan-title">New four-year plan</h2><button type="button" aria-label="Close" onClick={() => setDialogMode(null)}><X size={17} /></button></header>
        <label className="field"><span>Name</span><input autoFocus value={label} maxLength={100} onChange={(event) => setLabel(event.target.value)} placeholder="College-focused plan" /></label>
        <label className="field"><span>Planning strategy</span><select value={strategy} onChange={(event) => setStrategy(event.target.value as PlanStrategy)}>{Object.entries(PLAN_STRATEGY_LABELS).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select><small>Pilot uses this purpose when you ask it to build or revise this plan.</small></label>
        <fieldset><legend>Starting point</legend>
          <label><input type="radio" name="new-plan-start" value="copy" checked={!startEmpty} onChange={() => setStartEmpty(false)} /> Copy {active.label}</label>
          <label><input type="radio" name="new-plan-start" value="empty" checked={startEmpty} onChange={() => setStartEmpty(true)} /> Start with an empty four-year plan</label>
        </fieldset>
        <footer><button className="quiet-button" type="button" onClick={() => setDialogMode(null)}>Cancel</button><button className="primary-button" type="button" onClick={() => void createVersion()} disabled={!label.trim() || busy === "create"}>{busy === "create" ? "Creating" : "Create plan"}</button></footer>
      </section>
    </div>}

    {dialogMode === "rename" && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogMode(null); }}>
      <section className="plan-version-dialog compact" role="dialog" aria-modal="true" aria-labelledby="rename-plan-title">
        <header><h2 id="rename-plan-title">Rename plan</h2><button type="button" aria-label="Close" onClick={() => setDialogMode(null)}><X size={17} /></button></header>
        <label className="field"><span>Name</span><input autoFocus value={label} maxLength={100} onChange={(event) => setLabel(event.target.value)} /></label>
        <footer><button className="quiet-button" type="button" onClick={() => setDialogMode(null)}>Cancel</button><button className="primary-button" type="button" onClick={() => void renameVersion()} disabled={!label.trim() || busy === "rename"}>Save</button></footer>
      </section>
    </div>}

    {dialogMode === "compare" && compareTarget && comparison && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogMode(null); }}>
      <section className="plan-version-dialog compare" role="dialog" aria-modal="true" aria-labelledby="compare-plans-title">
        <header><div><h2 id="compare-plans-title">Compare plans</h2><p>Progress reflects the courses saved in each complete four-year plan.</p></div><button type="button" aria-label="Close" onClick={() => setDialogMode(null)}><X size={17} /></button></header>
        <label className="compare-plan-picker"><span>Compare {active.label} with</span><select value={compareVersionId} onChange={(event) => void loadComparison(event.target.value)}>
          {scopedVersions.filter((version) => version.id !== activeVersion.id).map((version) => <option value={version.id} key={version.id}>{version.label}</option>)}
        </select></label>
        <div className="plan-comparison-table" role="table" aria-label="Plan comparison">
          <div className="plan-comparison-head" role="row"><span role="columnheader">Metric</span><strong role="columnheader">{active.label}</strong><strong role="columnheader">{compareTarget.label}</strong></div>
          {comparisonRows.map((row) => <div role="row" key={row.key}><span role="cell">{row.label}</span><MetricValue value={comparison[activeVersion.id]?.[row.key] ?? null} suffix={row.suffix} /><MetricValue value={comparison[compareTarget.id]?.[row.key] ?? null} suffix={row.suffix} /></div>)}
        </div>
        {goals.length > 0 && <section className="plan-comparison-degrees"><h3>Bookmarked degrees</h3>{goals.map((goal) => {
          const left = comparison[activeVersion.id]?.degreeProgress.find((item) => item.programId === goal.program_id);
          const right = comparison[compareTarget.id]?.degreeProgress.find((item) => item.programId === goal.program_id);
          return <div key={goal.id}><span>{left?.label ?? right?.label ?? goal.program_id}</span><strong>{left?.percent ?? 0}%</strong><strong>{right?.percent ?? 0}%</strong></div>;
        })}</section>}
        <section className="plan-comparison-differences"><header><h3>Course differences</h3><p>Select courses from {compareTarget.label} to merge into {active.label}.</p></header>
          {differences.length === 0 ? <p className="empty-note">These plans contain the same courses and placements.</p> : <div>{differences.map((item) => <label key={`${item.kind}:${item.sourceCourseId}`} className={item.kind === "removed" ? "removed" : ""}>
            {item.kind !== "removed" ? <input type="checkbox" checked={selectedMergeIds.has(item.sourceCourseId)} onChange={(event) => setSelectedMergeIds((current) => { const next = new Set(current); if (event.target.checked) next.add(item.sourceCourseId); else next.delete(item.sourceCourseId); return next; })} /> : <span aria-hidden>−</span>}
            <span><strong>{item.label}</strong><small>{item.kind === "moved" ? `${item.previousPlacement} → ${item.placement}` : `${item.kind === "added" ? "Only in comparison" : `Only in ${active.label}`} · ${item.placement}`}</small></span>
          </label>)}</div>}
        </section>
        <footer><button className="quiet-button" type="button" onClick={() => setDialogMode(null)}>Close</button><button className="secondary-button" type="button" onClick={() => void activate(compareTarget.id)}>Open {compareTarget.label}</button><button className="primary-button" type="button" onClick={() => void mergeSelectedCourses()} disabled={selectedMergeIds.size === 0 || busy === "merge"}>{busy === "merge" ? "Merging" : `Merge ${selectedMergeIds.size || "selected"}`}</button></footer>
      </section>
    </div>}
  </>;
}
