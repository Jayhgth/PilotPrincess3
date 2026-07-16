import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

export function safeAuthRedirect(value: string | null | undefined, fallback = "/app") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

export function authCallbackUrl(next = "/app") {
  if (typeof window === "undefined") return `/auth/callback?next=${encodeURIComponent(safeAuthRedirect(next))}`;
  const url = new URL("/auth/callback", window.location.origin);
  url.searchParams.set("next", safeAuthRedirect(next));
  return url.toString();
}

export async function ensureAuthenticatedWorkspace(supabase: SupabaseClient): Promise<User> {
  const userResult = await supabase.auth.getUser();
  if (userResult.error || !userResult.data.user) throw userResult.error ?? new Error("Authentication could not be verified.");
  const provision = await supabase.rpc("ensure_current_user_workspace_v1");
  if (provision.error) throw provision.error;
  return userResult.data.user;
}

export async function googleOAuthIsAvailable() {
  const env = getPublicEnv();
  const response = await fetch(`${env.PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: env.PUBLIC_SUPABASE_ANON_KEY }
  });
  if (!response.ok) return false;
  const settings = await response.json() as { external?: { google?: boolean } };
  return settings.external?.google === true;
}
