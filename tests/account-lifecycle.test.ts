import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { readStoragePaths } from "@/pages/api/account/delete";
import { readAllUserRows } from "@/pages/api/account/export";

function pagedClient(pages: Array<Array<Record<string, unknown>>>) {
  const range = vi.fn().mockImplementation(async () => ({ data: pages.shift() ?? [], error: null }));
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    range
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.order.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return { client: { from } as unknown as SupabaseClient, from, range };
}

describe("account lifecycle data boundaries", () => {
  it("exports every page instead of stopping at the database row limit", async () => {
    const firstPage = Array.from({ length: 500 }, (_, id) => ({ id }));
    const secondPage = [{ id: 500 }];
    const { client, range } = pagedClient([firstPage, secondPage]);

    const result = await readAllUserRows(client, "ai_events", "user-1", { order: ["id"] });

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(501);
    expect(range).toHaveBeenNthCalledWith(1, 0, 499);
    expect(range).toHaveBeenNthCalledWith(2, 500, 999);
  });

  it("collects every stored file path before account deletion", async () => {
    const firstPage = Array.from({ length: 500 }, (_, id) => ({ storage_path: `user-1/${id}.png` }));
    const secondPage = [{ storage_path: "user-1/500.png" }];
    const { client, range } = pagedClient([firstPage, secondPage]);

    const result = await readStoragePaths(client, "ai_message_attachments", "user-1");

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(501);
    expect(range).toHaveBeenCalledTimes(2);
  });
});
