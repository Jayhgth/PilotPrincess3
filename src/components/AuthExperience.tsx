import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CheckCircleIcon as CheckCircle,
  ShieldCheckIcon as ShieldCheck
} from "@phosphor-icons/react";
import { lazy, Suspense, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { hasPublicEnv } from "@/lib/env";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import BrandMark from "@/components/BrandMark";
import SpotlightCard from "@/components/reactbits/SpotlightCard";

const EvilEye = lazy(() => import("@/components/reactbits/EvilEye"));

type AuthMode = "sign-in" | "sign-up" | "forgot-password";

function authenticationMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Authentication failed.";
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "That email and password do not match. Check both fields or reset your password.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Confirm your email before signing in.";
  }
  if (normalized.includes("user already registered") || normalized.includes("already been registered")) {
    return "An account already exists for this email. Sign in or reset your password.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "Too many attempts were made. Wait a few minutes, then try again.";
  }

  return message;
}

export default function AuthExperience() {
  const configured = hasPublicEnv();
  const supabase = useMemo(() => (configured ? getBrowserSupabase() : null), [configured]);
  const demoLoginPreview = useMemo(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("demo") === "login";
  }, []);
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("password_reset") === "success"
      ? "Your password was updated. Sign in with your new password."
      : null;
  });

  useEffect(() => {
    if (!supabase || demoLoginPreview) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.assign("/app");
    });
  }, [demoLoginPreview, supabase]);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setNotice(null);
  }

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!supabase) {
      setError("Supabase environment variables are not configured.");
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (mode !== "forgot-password" && password.length < 8) {
      setError("Use a password with at least eight characters.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "forgot-password") {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
          redirectTo: `${window.location.origin}/reset-password`
        });
        if (resetError) throw resetError;
        setNotice("If an account exists for that email, a reset link is on its way.");
      } else if (mode === "sign-up") {
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
          await supabase.rpc("log_app_event", { event_name: "user_signed_up", properties: { registration: "open_email" } });
          window.location.assign("/app");
        } else {
          setNotice("Check your inbox to confirm your account, then return here to sign in.");
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
      setError(authenticationMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-labelledby="auth-title">
        <Suspense fallback={<div aria-hidden="true" className="auth-page-background" />}>
          <EvilEye
            backgroundColor="#0c0d0f"
            className="auth-page-background"
            eyeColor="#b84d6a"
            flameSpeed={0.7}
            glowIntensity={0.3}
            intensity={1.15}
            irisWidth={0.28}
            noiseScale={1}
            pupilFollow={0.75}
            pupilSize={0.68}
            scale={0.74}
          />
        </Suspense>
        <a className="wordmark" href="/" aria-label="Pilot Princess home">
          <BrandMark />
          <span>Pilot Princess</span>
        </a>
        <div className="auth-story-copy">
          <p className="auth-kicker">High school planning</p>
          <h1 id="auth-title">See the whole path.</h1>
          <p>
            Build a source-backed four-year plan before choosing classes and college options.
          </p>
        </div>
      </section>

      <section
        className="auth-panel"
        aria-label={mode === "sign-in" ? "Sign in" : mode === "sign-up" ? "Create account" : "Reset password"}
      >
        <div className="auth-panel-stack">
          <SpotlightCard className="auth-card">
            <div className="auth-panel-inner">
          {demoLoginPreview && (
            <a className="auth-back-link auth-demo-return" data-demo-only="true" href="/app">
              <ArrowLeft size={16} weight="bold" aria-hidden />
              Return to workspace
            </a>
          )}
          <div className="auth-switch" role="tablist" aria-label="Authentication mode">
            <button
              className={mode === "sign-in" || mode === "forgot-password" ? "active" : ""}
              onClick={() => changeMode("sign-in")}
              type="button"
              role="tab"
              aria-selected={mode === "sign-in" || mode === "forgot-password"}
            >
              Sign in
            </button>
            <button
              className={mode === "sign-up" ? "active" : ""}
              onClick={() => changeMode("sign-up")}
              type="button"
              role="tab"
              aria-selected={mode === "sign-up"}
            >
              Create account
            </button>
          </div>

          <header className="auth-form-header">
            <h2>
              {mode === "sign-in" ? "Welcome back" : mode === "sign-up" ? "Start a source-backed plan" : "Reset your password"}
            </h2>
            <p>
              {mode === "sign-in"
                ? "Use the email connected to your account."
                : mode === "sign-up"
                  ? "Create an account with any valid email address."
                  : "We will email a secure reset link to your account."}
            </p>
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
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            {mode !== "forgot-password" && (
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
            )}
            {mode === "sign-in" && (
              <button className="auth-inline-action" type="button" onClick={() => changeMode("forgot-password")}>
                Forgot password?
              </button>
            )}
            <button className="primary-button auth-submit" type="submit" disabled={busy || !configured}>
              <span>
                {busy
                  ? "Please wait"
                  : mode === "sign-in"
                    ? "Open workspace"
                    : mode === "sign-up"
                      ? "Create account"
                      : "Email reset link"}
              </span>
              <ArrowRight size={18} weight="bold" aria-hidden />
            </button>
            {mode === "forgot-password" && (
              <button className="auth-back-action" type="button" onClick={() => changeMode("sign-in")}>
                <ArrowLeft size={16} weight="bold" aria-hidden />
                Back to sign in
              </button>
            )}
          </form>

            </div>
          </SpotlightCard>
          <div className="auth-guardrails">
            <p><ShieldCheck size={18} weight="duotone" aria-hidden /> Private student data is protected by per-user database policies.</p>
            <p><CheckCircle size={18} weight="duotone" aria-hidden /> Uncertain source mappings never count as fully verified.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
