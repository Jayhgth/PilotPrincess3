import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";

export const prerender = false;

const RESETTABLE_STORAGE_BUCKETS = ["source-uploads", "ai-attachments"] as const;

async function listOwnedStoragePaths(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 100,
      offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw error;

    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      if (entry.id || entry.metadata) paths.push(path);
      else paths.push(...await listOwnedStoragePaths(supabase, bucket, path));
    }

    if (!data || data.length < 100) break;
    offset += data.length;
  }

  return paths;
}

async function clearOwnedStorage(supabase: SupabaseClient, userId: string) {
  for (const bucket of RESETTABLE_STORAGE_BUCKETS) {
    const paths = await listOwnedStoragePaths(supabase, bucket, userId);
    for (let index = 0; index < paths.length; index += 100) {
      const { error } = await supabase.storage.from(bucket).remove(paths.slice(index, index + 100));
      if (error) throw error;
    }
  }
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);

  const { data: isAdmin, error: adminError } = await auth.supabase.rpc("is_app_admin");
  if (adminError) return jsonError("Administrator status could not be verified.", 500);
  if (isAdmin !== true) return jsonError("Administrator access required.", 403);

  try {
    await clearOwnedStorage(auth.supabase, auth.user.id);
    const { data, error } = await auth.supabase.rpc("reset_current_admin_workspace");
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, reset: data }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "The test workspace could not be reset.",
      500
    );
  }
};
