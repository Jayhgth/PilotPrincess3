import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

export interface AuthenticatedRequest {
  user: User;
  token: string;
  supabase: SupabaseClient;
}

export async function authenticateRequest(request: Request): Promise<AuthenticatedRequest | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  if (!token) return null;

  const env = getPublicEnv();
  const supabase = createClient(env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, token, supabase };
}

export function jsonError(message: string, status: number, details?: unknown) {
  return new Response(JSON.stringify({ error: message, details }), {
    status,
    headers: { "content-type": "application/json" }
  });
}
