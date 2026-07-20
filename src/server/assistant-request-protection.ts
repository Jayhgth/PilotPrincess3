type AssistantTurnRpcError = {
  code?: string | null;
  message?: string | null;
};

type AssistantTurnRpcResult = {
  data: unknown;
  error: AssistantTurnRpcError | null;
};

export type AssistantTurnProtection =
  | { status: "allowed"; retryAfterSeconds: 0 }
  | { status: "limited"; retryAfterSeconds: number }
  | { status: "unavailable"; retryAfterSeconds: 0; error: AssistantTurnRpcError };

const RETRY_DELAY_MS = 180;

async function callRequestLimiter(
  callLimiter: () => PromiseLike<AssistantTurnRpcResult>
): Promise<AssistantTurnRpcResult> {
  try {
    return await callLimiter();
  } catch (error) {
    return {
      data: null,
      error: {
        code: "LIMITER_CALL_FAILED",
        message: error instanceof Error ? error.message : "The request limiter could not be reached."
      }
    };
  }
}

function firstResultRow(value: unknown): Record<string, unknown> | null {
  const row = Array.isArray(value) ? value[0] : value;
  return row && typeof row === "object" && !Array.isArray(row)
    ? row as Record<string, unknown>
    : null;
}

export async function acquireAssistantTurn(
  callLimiter: () => PromiseLike<AssistantTurnRpcResult>,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<AssistantTurnProtection> {
  let result = await callRequestLimiter(callLimiter);
  if (result.error) {
    await wait(RETRY_DELAY_MS);
    result = await callRequestLimiter(callLimiter);
  }

  if (result.error) {
    return { status: "unavailable", retryAfterSeconds: 0, error: result.error };
  }

  const row = firstResultRow(result.data);
  if (!row || typeof row.allowed !== "boolean") {
    return {
      status: "unavailable",
      retryAfterSeconds: 0,
      error: { code: "INVALID_LIMITER_RESPONSE", message: "The request limiter returned an invalid response." }
    };
  }

  if (row.allowed) return { status: "allowed", retryAfterSeconds: 0 };
  return {
    status: "limited",
    retryAfterSeconds: Math.max(1, Number(row.retry_after_seconds ?? 60))
  };
}
