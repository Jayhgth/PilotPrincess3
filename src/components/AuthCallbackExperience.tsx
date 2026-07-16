import { CheckCircleIcon as CheckCircle, WarningIcon as Warning } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import BrandMark from "@/components/BrandMark";
import { ensureAuthenticatedWorkspace, safeAuthRedirect } from "@/lib/auth";
import { hasPublicEnv } from "@/lib/env";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type CallbackState = "working" | "complete" | "error";

export default function AuthCallbackExperience() {
  const configured = hasPublicEnv();
  const supabase = useMemo(() => configured && typeof window !== "undefined" ? getBrowserSupabase() : null, [configured]);
  const [state, setState] = useState<CallbackState>(configured ? "working" : "error");
  const [message, setMessage] = useState(configured ? "Verifying your sign-in…" : "Authentication is not configured.");

  useEffect(() => {
    if (!supabase) return;
    void (async () => {
      const url = new URL(window.location.href);
      const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      if (providerError) throw new Error(providerError);
      const code = url.searchParams.get("code");
      if (code) {
        const exchange = await supabase.auth.exchangeCodeForSession(code);
        if (exchange.error) throw exchange.error;
      }
      await ensureAuthenticatedWorkspace(supabase);
      setState("complete");
      setMessage("Sign-in verified. Opening your workspace…");
      window.history.replaceState({}, "", "/auth/callback");
      window.location.replace(safeAuthRedirect(url.searchParams.get("next")));
    })().catch(async (caught) => {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      setState("error");
      setMessage(caught instanceof Error ? caught.message : "The sign-in could not be completed.");
    });
  }, [supabase]);

  return <main className="auth-callback-page">
    <section className="auth-callback-card" role={state === "error" ? "alert" : "status"}>
      <BrandMark />
      {state === "error" ? <Warning size={20} weight="fill" aria-hidden /> : <CheckCircle size={20} weight="fill" aria-hidden />}
      <h1>{state === "error" ? "Sign-in could not be completed" : "Signing you in"}</h1>
      <p>{message}</p>
      {state === "error" && <a className="secondary-button" href="/">Return to sign in</a>}
    </section>
  </main>;
}
