import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CheckCircleIcon as CheckCircle,
  ShieldCheckIcon as ShieldCheck
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { hasPublicEnv } from "@/lib/env";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type RecoveryState = "checking" | "ready" | "invalid" | "complete";

export default function PasswordResetExperience() {
  const configured = hasPublicEnv();
  const supabase = useMemo(() => (configured ? getBrowserSupabase() : null), [configured]);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>(configured ? "checking" : "invalid");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let invalidTimer: ReturnType<typeof setTimeout> | undefined;
    const markInvalidSoon = () => {
      invalidTimer = setTimeout(() => setRecoveryState((current) => current === "checking" ? "invalid" : current), 1200);
    };

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) {
        if (invalidTimer) clearTimeout(invalidTimer);
        setRecoveryState("ready");
      } else if (event === "INITIAL_SESSION") {
        markInvalidSoon();
      }
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) setRecoveryState("ready");
      else markInvalidSoon();
    });

    return () => {
      if (invalidTimer) clearTimeout(invalidTimer);
      subscription.subscription.unsubscribe();
    };
  }, [supabase]);

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setError(null);
    if (!supabase) {
      setError("Supabase environment variables are not configured.");
      return;
    }
    if (password.length < 8) {
      setError("Use a password with at least eight characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }

    setRecoveryState("complete");
    await supabase.auth.signOut();
    window.location.assign("/?password_reset=success");
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-labelledby="reset-story-title">
        <a className="wordmark" href="/" aria-label="Pilot Princess home">
          <span className="wordmark-mark">PP</span>
          <span>Pilot Princess</span>
        </a>
        <div className="auth-story-copy">
          <p className="auth-kicker">Account recovery</p>
          <h1 id="reset-story-title">Choose a new password and get back to your plan.</h1>
          <p>Your courses, sources, and saved plan stay connected to your existing account.</p>
        </div>
        <div className="auth-recovery-note">
          <ShieldCheck size={20} weight="duotone" aria-hidden />
          <p>Only a valid, time-limited link from your inbox can change the password.</p>
        </div>
      </section>

      <section className="auth-panel" aria-label="Choose a new password">
        <div className="auth-panel-inner">
          <a className="auth-back-link" href="/">
            <ArrowLeft size={16} weight="bold" aria-hidden />
            Return to sign in
          </a>

          <header className="auth-form-header reset-form-header">
            <h2>Choose a new password</h2>
            <p>Use at least eight characters and avoid a password you use elsewhere.</p>
          </header>

          {!configured && (
            <div className="inline-alert error" role="alert">
              Add the Supabase URL and publishable key from <code>.env.example</code>.
            </div>
          )}

          {recoveryState === "checking" && (
            <div className="auth-checking" role="status">Checking your secure reset link...</div>
          )}

          {recoveryState === "invalid" && configured && (
            <div className="auth-reset-invalid">
              <div className="inline-alert error" role="alert">
                This reset link is invalid or has expired. Request a new link from the sign-in page.
              </div>
              <a className="primary-button auth-submit" href="/">
                <span>Request another link</span>
                <ArrowRight size={18} weight="bold" aria-hidden />
              </a>
            </div>
          )}

          {recoveryState === "ready" && (
            <form className="auth-form" onSubmit={submit}>
              {error && <div className="inline-alert error" role="alert">{error}</div>}
              <label>
                <span>New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  required
                />
                <small>At least eight characters.</small>
              </label>
              <label>
                <span>Confirm new password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  minLength={8}
                  required
                />
              </label>
              <button className="primary-button auth-submit" type="submit" disabled={busy}>
                <span>{busy ? "Updating password" : "Update password"}</span>
                <ArrowRight size={18} weight="bold" aria-hidden />
              </button>
            </form>
          )}

          {recoveryState === "complete" && (
            <div className="inline-alert success" role="status">
              <CheckCircle size={18} weight="duotone" aria-hidden /> Password updated. Returning to sign in.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
