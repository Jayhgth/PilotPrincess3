import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { undoAssistantToolCall } from "@/server/assistant-undo";
import { affectedWorkspaceDomains } from "@/lib/app-capabilities";

export const prerender = false;

const requestSchema = z.object({ toolCallId: z.uuid() });

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Invalid undo request.", 400);

  try {
    const result = await undoAssistantToolCall({
      supabase: auth.supabase,
      userId: auth.user.id,
      toolCallId: parsed.data.toolCallId
    });
    return new Response(JSON.stringify({ undone: true, summary: result.summary, affected_domains: affectedWorkspaceDomains(result.toolName) }), { headers: { "content-type": "application/json" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "The change could not be undone.", 400);
  }
};
