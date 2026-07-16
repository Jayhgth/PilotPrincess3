import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";

export const prerender = false;

const updateSchema = z.object({
  requestId: z.uuid(),
  status: z.enum(["open", "in_progress", "resolved", "closed"]),
  response: z.string().trim().max(4000).nullable().default(null)
}).refine((value) => !["resolved", "closed"].includes(value.status) || Boolean(value.response && value.response.length >= 3), {
  message: "Resolved and closed requests need an administrator response."
});

async function requireAdmin(request: Request) {
  const auth = await authenticateRequest(request);
  if (!auth) return null;
  const { data, error } = await auth.supabase.rpc("is_app_admin");
  if (error || data !== true) return null;
  return auth;
}

export const GET: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("Administrator access required.", 403);
  const { data, error } = await auth.supabase.from("support_requests")
    .select("*, schools(name)")
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) return jsonError(error.message, 500);
  return Response.json({ requests: data ?? [] });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("Administrator access required.", 403);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Choose a valid support update.", 400);
  const response = parsed.data.response?.trim() || null;
  const resolved = parsed.data.status === "resolved" || parsed.data.status === "closed";
  const { data, error } = await auth.supabase.from("support_requests").update({
    status: parsed.data.status,
    admin_response: response,
    assigned_admin_id: auth.user.id,
    resolved_at: resolved ? new Date().toISOString() : null
  }).eq("id", parsed.data.requestId).select("*, schools(name)").single();
  if (error) return jsonError(error.message, 400);
  return Response.json({ request: data });
};
