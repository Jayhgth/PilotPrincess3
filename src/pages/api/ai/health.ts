import type { APIRoute } from "astro";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { codexRuntimeStatus } from "@/server/codex";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  return new Response(JSON.stringify(codexRuntimeStatus()), {
    headers: { "content-type": "application/json" }
  });
};
