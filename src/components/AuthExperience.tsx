import {
  ArrowRightIcon as ArrowRight,
  CheckCircleIcon as CheckCircle,
  ShieldCheckIcon as ShieldCheck
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { hasPublicEnv } from "@/lib/env";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type AuthMode = "sign-in" | "sign-up";

export default function AuthExperience() {
  const configured = hasPublicEnv();
  const supabase = useMemo(() => (configured ? getBrowserSupabase() : null), [configured]);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.assign("/app");
    });
  }, [supabase]);

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!supabase) {
      setError("Supabase environment variables are not configured.");
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (mode === "sign-up" && !normalizedEmail.endsWith("@dtechhs.org")) {
      setError("Registration currently requires a dtechhs.org email address.");
      return;
    }
    if (password.length < 8) {
      setError("Use a password with at least eight characters.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "sign-up") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: { preferred_name: preferredName.trim() },
            emailRedirectTo: `${window.location.origin}/app`
          }
        });
        if (signUpError) throw signUpError;
        if (data.session) {
          await supabase.rpc("log_app_event", { event_name: "user_signed_up", properties: { domain: "dtechhs.org" } });
          window.location.assign("/app");
        } else {
          setNotice("Check your d.tech inbox to confirm your account, then return here to sign in.");
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password
        });
        if (signInError) throw signInError;
        window.location.assign("/app");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-labelledby="auth-title">
        <a className="wordmark" href="/" aria-label="Pilot Princess home">
          <span className="wordmark-mark">PP</span>
          <span>Pilot Princess</span>
        </a>
        <div className="auth-story-copy">
          <p className="auth-kicker">Built for d.tech</p>
          <h1 id="auth-title">See the whole route before choosing the next class.</h1>
          <p>
            Plan four years of courses, requirements, activities, and workload with every recommendation tied back to a source.
          </p>
        </div>
        <div className="auth-facts" aria-label="Official data summary">
          <div><strong>225</strong><span>required credits</span></div>
          <div><strong>41</strong><span>official courses</span></div>
          <div><strong>2025-26</strong><span>source year</span></div>
        </div>
        <p className="auth-source-note">
          Source-backed planning aid. Final graduation and enrollment decisions must be confirmed with d.tech counseling.
        </p>
      </section>

      <section className="auth-panel" aria-label={mode === "sign-in" ? "Sign in" : "Create account"}>
        <div className="auth-panel-inner">
          <div className="auth-switch" role="tablist" aria-label="Authentication mode">
            <button className={mode === "sign-in" ? "active" : ""} onClick={() => setMode("sign-in")} type="button" role="tab">
              Sign in
            </button>
            <button className={mode === "sign-up" ? "active" : ""} onClick={() => setMode("sign-up")} type="button" role="tab">
              Create account
            </button>
          </div>

          <header className="auth-form-header">
            <h2>{mode === "sign-in" ? "Welcome back" : "Start a source-backed plan"}</h2>
            <p>{mode === "sign-in" ? "Use your d.tech account to continue." : "Registration is currently limited to d.tech students."}</p>
          </header>

          {!configured && (
            <div className="inline-alert error">
              Add the Supabase URL and publishable key from <code>.env.example</code>.
            </div>
          )}
          {error && <div className="inline-alert error" role="alert">{error}</div>}
          {notice && <div className="inline-alert success" role="status">{notice}</div>}

          <form className="auth-form" onSubmit={submit}>
            {mode === "sign-up" && (
              <label>
                <span>Preferred name</span>
                <input
                  autoComplete="given-name"
                  value={preferredName}
                  onChange={(event) => setPreferredName(event.target.value)}
                  required
                />
              </label>
            )}
            <label>
              <span>d.tech email</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="student@dtechhs.org"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Password</span>
              <input
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
              <small>At least eight characters.</small>
            </label>
            <button className="primary-button auth-submit" type="submit" disabled={busy || !configured}>
              <span>{busy ? "Please wait" : mode === "sign-in" ? "Open workspace" : "Create account"}</span>
              <ArrowRight size={18} weight="bold" aria-hidden />
            </button>
          </form>

          <div className="auth-guardrails">
            <p><ShieldCheck size={18} weight="duotone" aria-hidden /> Private student data is protected by per-user database policies.</p>
            <p><CheckCircle size={18} weight="duotone" aria-hidden /> Uncertain source mappings never count as fully verified.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
