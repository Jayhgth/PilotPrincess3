import type { APIRoute } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";

export const prerender = false;

const requestSchema = z.object({ confirmation: z.literal("DELETE") });
const PAGE_SIZE = 500;

export async function readStoragePaths(supabase: SupabaseClient, table: string, userId: string) {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const result = await supabase
      .from(table)
      .select("storage_path")
      .eq("user_id", userId)
      .not("storage_path", "is", null)
      .order("storage_path")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (result.error) return { data: null, error: result.error };
    const page = (result.data ?? []) as unknown as Array<{ storage_path: string }>;
    paths.push(...page.map((row) => row.storage_path));
    if (page.length < PAGE_SIZE) return { data: paths, error: null };
  }
}

async function removePaths(
  auth: NonNullable<Awaited<ReturnType<typeof authenticateRequest>>>,
  bucket: string,
  paths: string[]
) {
  const uniquePaths = [...new Set(paths)];
  for (let index = 0; index < uniquePaths.length; index += 100) {
    const chunk = uniquePaths.slice(index, index + 100);
    const result = await auth.supabase.storage.from(bucket).remove(chunk);
    if (result.error) throw new Error(result.error.message);
  }
}

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Type DELETE to confirm account deletion.", 400);

  const [sourceResult, attachmentResult] = await Promise.all([
    readStoragePaths(auth.supabase, "official_sources", auth.user.id),
    readStoragePaths(auth.supabase, "ai_message_attachments", auth.user.id)
  ]);
  const lookupError = sourceResult.error ?? attachmentResult.error;
  if (lookupError) return jsonError(lookupError.message, 500);

  try {
    await removePaths(
      auth,
      "source-uploads",
      sourceResult.data ?? []
    );
    await removePaths(
      auth,
      "ai-attachments",
      attachmentResult.data ?? []
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Stored files could not be deleted.", 500);
  }

  const deletion = await auth.supabase.rpc("delete_current_user_account");
  if (deletion.error) return jsonError(deletion.error.message, 500);

  return new Response(JSON.stringify({ deleted: true }), {
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
};
