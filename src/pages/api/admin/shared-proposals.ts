import type { APIRoute } from "astro";
import { z } from "zod";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";

export const prerender = false;

const reviewSchema = z.object({
  proposalId: z.uuid(),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(600).nullable().default(null)
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
  const { data, error } = await auth.supabase
    .from("shared_data_proposals")
    .select("*, schools(name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return jsonError(error.message, 500);
  return Response.json({ proposals: data ?? [] });
};

export const POST: APIRoute = async ({ request }) => {
  const auth = await requireAdmin(request);
  if (!auth) return jsonError("Administrator access required.", 403);
  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose an exact proposal and review decision.", 400);
  const { data, error } = await auth.supabase.rpc("review_shared_data_proposal", {
    proposal_id: parsed.data.proposalId,
    decision: parsed.data.decision,
    note: parsed.data.note
  });
  if (error) return jsonError(error.message, 400);
  return Response.json({ proposal: data });
};
