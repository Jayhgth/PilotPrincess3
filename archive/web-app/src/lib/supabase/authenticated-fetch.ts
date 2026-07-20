import type { SupabaseClient } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const SESSION_EXPIRED_MESSAGE = "Your session expired. Sign in again to use Pilot.";

function requestWithToken(init: RequestInit | undefined, accessToken: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  return { ...init, headers };
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  supabase: SupabaseClient = getBrowserSupabase()
) {
  const sessionResult = await supabase.auth.getSession();
  if (sessionResult.error || !sessionResult.data.session) throw new Error(SESSION_EXPIRED_MESSAGE);

  const response = await fetch(input, requestWithToken(init, sessionResult.data.session.access_token));
  if (response.status !== 401) return response;

  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.error || !refreshed.data.session) throw new Error(SESSION_EXPIRED_MESSAGE);

  const retried = await fetch(input, requestWithToken(init, refreshed.data.session.access_token));
  if (retried.status === 401) throw new Error(SESSION_EXPIRED_MESSAGE);
  return retried;
}
