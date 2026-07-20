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

export type SupportedOAuthProvider = "google" | "github";

export async function oauthProviderAvailability() {
  const env = getPublicEnv();
  const response = await fetch(`${env.PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: env.PUBLIC_SUPABASE_ANON_KEY }
  });
  if (!response.ok) return { google: false, github: false };
  const settings = await response.json() as { external?: Partial<Record<SupportedOAuthProvider, boolean>> };
  return {
    google: settings.external?.google === true,
    github: settings.external?.github === true
  };
}
