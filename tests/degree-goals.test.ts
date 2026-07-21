import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertStudentSmccdGoals, loadStudentSmccdGoals } from "@/lib/smccd-goals";

describe("degree bookmark storage", () => {
  it("keeps bookmarks readable while production rolls out plan-scoped goals", async () => {
    const responses = [
      { data: null, error: { code: "42703", message: "column student_smccd_goals.plan_id does not exist" } },
      {
        data: [{ id: "goal-1", user_id: "user-1", program_id: "CSM:CIS", is_primary: false, notes: null }],
        error: null
      }
    ];
    const filters: Array<[string, unknown]> = [];
    const supabase = {
      from: () => {
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return query;
          },
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(responses.shift()).then(resolve)
        };
        return query;
      }
    } as unknown as SupabaseClient;

    const goals = await loadStudentSmccdGoals(supabase, "user-1", "plan-1", { force: true });

    expect(goals).toEqual([expect.objectContaining({ id: "goal-1", plan_id: "plan-1", notes: "" })]);
    expect(filters).toEqual([
      ["user_id", "user-1"],
      ["plan_id", "plan-1"],
      ["user_id", "user-1"]
    ]);

    let insertedRows: Array<Record<string, unknown>> = [];
    const insertSupabase = {
      from: () => ({
        insert: (rows: Array<Record<string, unknown>>) => {
          insertedRows = rows;
          return {
            select: () => Promise.resolve({
              data: rows.map((row, index) => ({ ...row, id: `saved-${index + 1}` })),
              error: null
            })
          };
        }
      })
    } as unknown as SupabaseClient;

    await insertStudentSmccdGoals(insertSupabase, {
      userId: "user-1",
      planId: "plan-1",
      goals: [{ programId: "CSM:CIS" }]
    });

    expect(insertedRows).toEqual([
      expect.objectContaining({ program_id: "CSM:CIS", notes: "" })
    ]);
  });
});
