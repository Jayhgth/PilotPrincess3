import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanCourse, PlanVersion } from "@/lib/models";
import { planVersionDisplayLabel, type PlanStrategy, type PlanVersionSummary } from "@/lib/plan-versions";

const COPYABLE_PLAN_COURSE_FIELDS = [
  "course_id", "custom_course_name", "grade_level", "school_year", "term", "status",
  "credits", "college_units", "letter_grade", "is_weighted", "mapping_verified",
  "user_edited", "notes", "sort_order", "source_review_item_id", "smccd_course_id",
  "college_provider_code", "requirement_area_override"
] as const;

// A development database can briefly lag the application migration. Once the
// lifecycle RPCs are known to be absent, avoid repeating the same failed
// request for every plan read and mutation during this page session.
let lifecycleRpcAvailable: boolean | null = null;
let strategyRpcAvailable: boolean | null = null;
const planVersionCache = new Map<string, PlanVersionSummary[]>();

export function cachedOwnedPlanVersions(planId: string) {
  return planVersionCache.get(planId) ?? null;
}

function rememberVersions(planId: string, versions: PlanVersionSummary[]) {
  planVersionCache.set(planId, versions);
  return versions;
}

function detectLegacyPlanSchema(activeVersion: PlanVersion) {
  if (lifecycleRpcAvailable === null && activeVersion.updated_at === undefined && activeVersion.archived_at === undefined) {
    lifecycleRpcAvailable = false;
  }
}

function missingLifecycleRpc(error: { message?: string; code?: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "PGRST202"
    || error?.code === "42883"
    || message.includes("list_plan_versions_v1")
    || message.includes("create_plan_version_v1")
    || message.includes("create_plan_version_v2")
    || message.includes("create_plan_version_v3")
    || message.includes("activate_plan_version_v1")
    || message.includes("rename_plan_version_v1")
    || message.includes("archive_plan_version_v1")
    || message.includes("restore_plan_version_v1")
    || (message.includes("function") && message.includes("plan_version"));
}

function visibleGenerationConfig(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function planVersionNameConflict(error: { message?: string } | null) {
  return (error?.message ?? "").toLowerCase().includes("plan with that name already exists");
}

async function releaseHiddenPlanVersionLabel(
  supabase: SupabaseClient,
  input: { userId: string; planId: string; label: string }
) {
  const matches = await supabase.from("plan_versions").select("id,label,generation_config")
    .eq("user_id", input.userId)
    .eq("plan_id", input.planId)
    .ilike("label", input.label.trim());
  if (matches.error) throw matches.error;
  const hidden = (matches.data ?? []).filter((version) => {
    const config = visibleGenerationConfig(version.generation_config);
    return config.role === "backup" || config.archived === true;
  });
  for (const version of hidden) {
    const renamed = await supabase.from("plan_versions").update({
      label: `${String(version.label).slice(0, 72)} · backup ${String(version.id).slice(0, 8)}`
    }).eq("id", version.id).eq("user_id", input.userId);
    if (renamed.error) throw renamed.error;
  }
  return hidden.length > 0;
}

export async function listOwnedPlanVersions(
  supabase: SupabaseClient,
  userId: string,
  activeVersion: PlanVersion
): Promise<PlanVersionSummary[]> {
  detectLegacyPlanSchema(activeVersion);
  if (lifecycleRpcAvailable !== false) {
    const rpc = await supabase.rpc("list_plan_versions_v1");
    if (!rpc.error) {
      lifecycleRpcAvailable = true;
      const loaded = (Array.isArray(rpc.data) ? rpc.data : []).map((version) => ({
        ...(version as PlanVersionSummary),
        label: planVersionDisplayLabel(version as PlanVersionSummary)
      }));
      if (loaded.length) {
        return rememberVersions(activeVersion.plan_id, loaded.some((version) => version.id === activeVersion.id) ? loaded : [{
          ...activeVersion,
          label: planVersionDisplayLabel(activeVersion),
          course_count: 0,
          updated_at: activeVersion.created_at,
          archived_at: null
        }, ...loaded]);
      }
    }
    if (rpc.error && !missingLifecycleRpc(rpc.error)) throw rpc.error;
    if (rpc.error) lifecycleRpcAvailable = false;
  }

  const versionsResult = await supabase.from("plan_versions")
    .select("id,plan_id,user_id,label,kind,generation_config,ai_summary,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (versionsResult.error) throw versionsResult.error;
  const ownedVersions = (versionsResult.data ?? []) as unknown as PlanVersion[];
  const targetPlanId = activeVersion.plan_id
    || ownedVersions.find((version) => version.id === activeVersion.id)?.plan_id;
  const versions = targetPlanId
    ? ownedVersions.filter((version) => version.plan_id === targetPlanId)
    : ownedVersions.filter((version) => version.id === activeVersion.id);
  const legacyDefault = versions.find((version) => version.kind === "active"
    && ["active plan", "current plan", ""].includes(version.label.trim().toLowerCase()));
  if (legacyDefault) {
    const normalization = await supabase.from("plan_versions").update({ label: "New plan" })
      .eq("id", legacyDefault.id).eq("user_id", userId);
    if (!normalization.error) legacyDefault.label = "New plan";
  }
  const ids = versions.map((version) => version.id);
  const rowsResult = ids.length
    ? await supabase.from("plan_courses").select("plan_version_id").eq("user_id", userId).in("plan_version_id", ids)
    : await supabase.from("plan_courses").select("plan_version_id").eq("user_id", userId).eq("plan_version_id", activeVersion.id);
  if (rowsResult.error) throw rowsResult.error;
  const counts = new Map<string, number>();
  for (const row of rowsResult.data ?? []) counts.set(row.plan_version_id, (counts.get(row.plan_version_id) ?? 0) + 1);
  const loaded = versions
    .filter((version) => visibleGenerationConfig(version.generation_config).archived !== true)
    .sort((left, right) => Number(right.kind === "active") - Number(left.kind === "active") || right.created_at.localeCompare(left.created_at))
    .map((version) => ({
      ...version,
      label: planVersionDisplayLabel(version),
      course_count: counts.get(version.id) ?? 0,
      updated_at: version.created_at,
      archived_at: null
    }));
  return rememberVersions(activeVersion.plan_id, loaded.length ? loaded : [{
    ...activeVersion,
    label: planVersionDisplayLabel(activeVersion),
    course_count: counts.get(activeVersion.id) ?? 0,
    updated_at: activeVersion.created_at,
    archived_at: null
  }]);
}

export async function createOwnedPlanVersion(supabase: SupabaseClient, input: {
  userId: string;
  activeVersion: PlanVersion;
  label: string;
  sourceVersionId?: string;
  activate: boolean;
  startEmpty: boolean;
  role: "plan" | "backup";
  strategy?: PlanStrategy;
}) {
  detectLegacyPlanSchema(input.activeVersion);
  if (lifecycleRpcAvailable !== false) {
    if (strategyRpcAvailable !== false) {
      const argumentsValue = {
        p_label: input.label,
        p_source_version_id: input.sourceVersionId ?? input.activeVersion.id,
        p_activate: input.activate,
        p_start_empty: input.startEmpty,
        p_role: input.role,
        p_strategy: input.strategy ?? "balanced"
      };
      let currentRpc = await supabase.rpc("create_plan_version_v3", argumentsValue);
      let rpc = currentRpc.error && missingLifecycleRpc(currentRpc.error)
        ? await supabase.rpc("create_plan_version_v2", argumentsValue)
        : currentRpc;
      if (rpc.error && planVersionNameConflict(rpc.error)) {
        const released = await releaseHiddenPlanVersionLabel(supabase, {
          userId: input.userId,
          planId: input.activeVersion.plan_id,
          label: input.label
        });
        if (released) {
          currentRpc = await supabase.rpc("create_plan_version_v3", argumentsValue);
          rpc = currentRpc.error && missingLifecycleRpc(currentRpc.error)
            ? await supabase.rpc("create_plan_version_v2", argumentsValue)
            : currentRpc;
        }
      }
      if (!rpc.error) {
        lifecycleRpcAvailable = true;
        strategyRpcAvailable = true;
        return rpc.data as Record<string, unknown>;
      }
      if (!missingLifecycleRpc(rpc.error)) throw rpc.error;
      strategyRpcAvailable = false;
    }
    const legacyRpc = await supabase.rpc("create_plan_version_v1", {
      p_label: input.label,
      p_source_version_id: input.sourceVersionId ?? input.activeVersion.id,
      p_activate: input.activate,
      p_start_empty: input.startEmpty,
      p_role: input.role
    });
    if (!legacyRpc.error) {
      lifecycleRpcAvailable = true;
      const created = legacyRpc.data as Record<string, unknown>;
      if (!input.strategy || typeof created.id !== "string") return created;
      const config = visibleGenerationConfig(created.generation_config);
      const strategyUpdate = await supabase.from("plan_versions").update({ generation_config: { ...config, strategy: input.strategy } })
        .eq("id", created.id).eq("user_id", input.userId).select("*").single();
      if (strategyUpdate.error) throw strategyUpdate.error;
      return { ...created, ...strategyUpdate.data } as Record<string, unknown>;
    }
    if (!missingLifecycleRpc(legacyRpc.error)) throw legacyRpc.error;
    lifecycleRpcAvailable = false;
  }

  const sourceId = input.sourceVersionId ?? input.activeVersion.id;
  const source = await supabase.from("plan_versions").select("id,plan_id").eq("id", sourceId).eq("user_id", input.userId).maybeSingle();
  if (source.error || !source.data) throw source.error ?? new Error("The source plan is unavailable.");
  const duplicate = await supabase.from("plan_versions").select("id,generation_config")
    .eq("user_id", input.userId).eq("plan_id", source.data.plan_id).ilike("label", input.label.trim()).limit(1);
  if (duplicate.error) throw duplicate.error;
  const duplicatePlan = (duplicate.data ?? []).some((version) => {
    const config = visibleGenerationConfig(version.generation_config);
    return config.archived !== true && config.role !== "backup";
  });
  if (duplicatePlan) throw new Error("A plan with that name already exists.");
  const insertion = await supabase.from("plan_versions").insert({
    plan_id: source.data.plan_id,
    user_id: input.userId,
    label: input.label,
    kind: "snapshot",
    generation_config: { role: input.role, source_version_id: sourceId, ...(input.strategy ? { strategy: input.strategy } : {}) },
    ai_summary: input.role === "backup" ? "Automatic backup before a broad Pilot change." : null
  }).select("*").single();
  if (insertion.error) throw insertion.error;
  const created = insertion.data as unknown as PlanVersion;
  let copiedCount = 0;
  try {
    if (!input.startEmpty) {
      const sourceRows = await supabase.from("plan_courses").select("*").eq("user_id", input.userId).eq("plan_version_id", sourceId);
      if (sourceRows.error) throw sourceRows.error;
      const copies = ((sourceRows.data ?? []) as unknown as PlanCourse[]).map((row) => ({
        plan_version_id: created.id,
        user_id: input.userId,
        ...Object.fromEntries(COPYABLE_PLAN_COURSE_FIELDS.map((field) => [field, row[field]]))
      }));
      if (copies.length) {
        const copy = await supabase.from("plan_courses").insert(copies);
        if (copy.error) throw copy.error;
      }
      copiedCount = copies.length;
    }
    if (input.activate) {
      const demotion = await supabase.from("plan_versions").update({
        kind: "snapshot",
        generation_config: { ...visibleGenerationConfig(input.activeVersion.generation_config), role: "plan" }
      }).eq("id", input.activeVersion.id).eq("user_id", input.userId);
      if (demotion.error) throw demotion.error;
      const promotion = await supabase.from("plan_versions").update({
        kind: "active",
        generation_config: { ...visibleGenerationConfig(created.generation_config), role: "plan" }
      }).eq("id", created.id).eq("user_id", input.userId);
      if (promotion.error) {
        await supabase.from("plan_versions").update({ kind: "active" }).eq("id", input.activeVersion.id).eq("user_id", input.userId);
        throw promotion.error;
      }
    }
  } catch (error) {
    await supabase.from("plan_versions").delete().eq("id", created.id).eq("user_id", input.userId);
    throw error;
  }
  return { ...created, kind: input.activate ? "active" : "snapshot", course_count: copiedCount, previous_active_version_id: input.activeVersion.id };
}

export async function activateOwnedPlanVersion(supabase: SupabaseClient, userId: string, activeVersion: PlanVersion, versionId: string) {
  detectLegacyPlanSchema(activeVersion);
  if (lifecycleRpcAvailable !== false) {
    const rpc = await supabase.rpc("activate_plan_version_v1", { p_version_id: versionId });
    if (!rpc.error) {
      lifecycleRpcAvailable = true;
      return rpc.data as Record<string, unknown>;
    }
    if (!missingLifecycleRpc(rpc.error)) throw rpc.error;
    lifecycleRpcAvailable = false;
  }
  const target = await supabase.from("plan_versions").select("*").eq("id", versionId).eq("user_id", userId).maybeSingle();
  if (target.error || !target.data) throw target.error ?? new Error("That plan is unavailable.");
  const demotion = await supabase.from("plan_versions").update({ kind: "snapshot" }).eq("id", activeVersion.id).eq("user_id", userId);
  if (demotion.error) throw demotion.error;
  const config = visibleGenerationConfig(target.data.generation_config);
  const promotion = await supabase.from("plan_versions").update({ kind: "active", generation_config: { ...config, role: "plan", archived: false } }).eq("id", versionId).eq("user_id", userId).select("*").single();
  if (promotion.error) {
    await supabase.from("plan_versions").update({ kind: "active" }).eq("id", activeVersion.id).eq("user_id", userId);
    throw promotion.error;
  }
  return { ...promotion.data, previous_active_version_id: activeVersion.id } as Record<string, unknown>;
}

export async function renameOwnedPlanVersion(supabase: SupabaseClient, userId: string, versionId: string, label: string) {
  if (lifecycleRpcAvailable !== false) {
    const rpc = await supabase.rpc("rename_plan_version_v1", { p_version_id: versionId, p_label: label });
    if (!rpc.error) {
      lifecycleRpcAvailable = true;
      return rpc.data;
    }
    if (!missingLifecycleRpc(rpc.error)) throw rpc.error;
    lifecycleRpcAvailable = false;
  }
  const result = await supabase.from("plan_versions").update({ label }).eq("id", versionId).eq("user_id", userId).select("*").single();
  if (result.error) throw result.error;
  return result.data;
}

export async function archiveOwnedPlanVersion(supabase: SupabaseClient, userId: string, versionId: string) {
  if (lifecycleRpcAvailable !== false) {
    const rpc = await supabase.rpc("archive_plan_version_v1", { p_version_id: versionId });
    if (!rpc.error) {
      lifecycleRpcAvailable = true;
      return rpc.data;
    }
    if (!missingLifecycleRpc(rpc.error)) throw rpc.error;
    lifecycleRpcAvailable = false;
  }
  const current = await supabase.from("plan_versions").select("*").eq("id", versionId).eq("user_id", userId).maybeSingle();
  if (current.error || !current.data) throw current.error ?? new Error("That plan is unavailable.");
  if (current.data.kind === "active") throw new Error("Switch to another plan before deleting the active plan.");
  const config = visibleGenerationConfig(current.data.generation_config);
  const result = await supabase.from("plan_versions").update({ generation_config: { ...config, archived: true } }).eq("id", versionId).eq("user_id", userId).select("*").single();
  if (result.error) throw result.error;
  return result.data;
}

export async function restoreOwnedPlanVersion(supabase: SupabaseClient, userId: string, versionId: string) {
  if (lifecycleRpcAvailable !== false) {
    const rpc = await supabase.rpc("restore_plan_version_v1", { p_version_id: versionId });
    if (!rpc.error) {
      lifecycleRpcAvailable = true;
      return rpc.data;
    }
    if (!missingLifecycleRpc(rpc.error)) throw rpc.error;
    lifecycleRpcAvailable = false;
  }
  const current = await supabase.from("plan_versions").select("*").eq("id", versionId).eq("user_id", userId).maybeSingle();
  if (current.error || !current.data) throw current.error ?? new Error("That deleted plan is no longer available.");
  const config = visibleGenerationConfig(current.data.generation_config);
  const result = await supabase.from("plan_versions").update({ generation_config: { ...config, archived: false } }).eq("id", versionId).eq("user_id", userId).select("*").single();
  if (result.error) throw result.error;
  return result.data;
}
