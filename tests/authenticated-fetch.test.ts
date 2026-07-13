import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";

function clientWithSessions(currentToken: string | null, refreshedToken: string | null = null) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: currentToken ? { access_token: currentToken } : null },
        error: null
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: refreshedToken ? { access_token: refreshedToken } : null },
        error: null
      })
    }
  } as unknown as SupabaseClient;
}

afterEach(() => vi.unstubAllGlobals());

describe("authenticated API requests", () => {
  it("uses the current browser session instead of a captured component token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await authenticatedFetch("/api/ai/conversations", undefined, clientWithSessions("current-token"));

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer current-token");
  });

  it("refreshes and retries once when an API rejects an expired token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = clientWithSessions("expired-token", "refreshed-token");

    const response = await authenticatedFetch("/api/ai/chat", { method: "POST" }, client);

    const retryHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(response.status).toBe(200);
    expect(client.auth.refreshSession).toHaveBeenCalledOnce();
    expect(retryHeaders.get("authorization")).toBe("Bearer refreshed-token");
  });

  it("returns a useful sign-in message when the browser session is gone", async () => {
    vi.stubGlobal("fetch", vi.fn());

    await expect(authenticatedFetch("/api/ai/conversations", undefined, clientWithSessions(null)))
      .rejects.toThrow("Your session expired. Sign in again to use Pilot.");
  });
});
