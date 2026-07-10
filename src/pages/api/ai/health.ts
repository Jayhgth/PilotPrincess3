import type { APIRoute } from "astro";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { probeCodexRuntimeStatus } from "@/server/codex";

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  const status = await probeCodexRuntimeStatus({ force: url.searchParams.get("refresh") === "1" });
  return new Response(JSON.stringify(status), {
    headers: { "content-type": "application/json" }
  });
};
