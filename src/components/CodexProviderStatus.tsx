import { ArrowClockwiseIcon as ArrowClockwise } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import styles from "./CodexProviderStatus.module.css";

export interface CodexProviderSnapshot {
  providerStatus: "ready" | "needs_auth" | "unavailable";
  providerMessage: string;
  authStatus: "configured" | "authenticated" | "unauthenticated" | "unknown";
  authType: string | null;
  authLabel: string | null;
  accountEmail: string | null;
  cliVersion: string | null;
}

export default function CodexProviderStatus({
  onStatusChange
}: {
  onStatusChange?: (status: CodexProviderSnapshot | null) => void;
}) {
  const [status, setStatus] = useState<CodexProviderSnapshot | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
    setChecking(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/ai/health${force ? "?refresh=1" : ""}`);
      const payload = await response.json() as CodexProviderSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Codex status could not be checked.");
      setStatus(payload);
      onStatusChange?.(payload);
    } catch (caught) {
      setStatus(null);
      onStatusChange?.(null);
      setError(caught instanceof Error ? caught.message : "Codex status could not be checked.");
    } finally {
      setChecking(false);
    }
  }, [onStatusChange]);

  useEffect(() => { void refresh(false); }, [refresh]);

  const ready = status?.providerStatus === "ready";
  const headline = checking
    ? "Checking Codex"
    : ready
      ? `Authenticated · ${status.authLabel ?? "Codex"}`
      : status?.authStatus === "unauthenticated"
        ? "Not authenticated"
        : "Codex unavailable";
  const detail = error
    ?? (ready
      ? [status?.accountEmail, status?.cliVersion ? `Codex ${status.cliVersion}` : null].filter(Boolean).join(" · ")
      : status?.providerMessage ?? "The local Codex provider could not be checked.");

  return <div className={`${styles.status} ${ready ? styles.ready : styles.problem}`} role="status">
    <span className={styles.dot} aria-hidden />
    <span className={styles.copy}><strong>{headline}</strong><small>{detail}</small></span>
    <button type="button" onClick={() => void refresh(true)} disabled={checking} aria-label="Refresh Codex status" title="Refresh Codex status">
      <ArrowClockwise size={15} className={checking ? styles.spinning : ""} />
    </button>
  </div>;
}
