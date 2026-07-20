import type { APIRoute } from "astro";
import { authenticateRequest, jsonError } from "@/lib/supabase/server";
import { connectLocalCodexAccount } from "@/server/codex";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const auth = await authenticateRequest(request);
  if (!auth) return jsonError("Authentication required.", 401);
  try {
    const status = await connectLocalCodexAccount();
    return new Response(JSON.stringify(status), {
      headers: { "content-type": "application/json", "cache-control": "no-store" }
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Codex sign-in did not complete.", 503);
  }
};
