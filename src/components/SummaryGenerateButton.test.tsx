import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SummaryGenerateButton from "@/components/SummaryGenerateButton";

describe("SummaryGenerateButton", () => {
  it("renders an explicit busy state while a summary is being generated", () => {
    const markup = renderToStaticMarkup(
      <SummaryGenerateButton loading disabled onClick={() => undefined} />
    );

    expect(markup).toContain("aria-busy=\"true\"");
    expect(markup).toContain("is-loading");
    expect(markup).toContain("Generating summary");
    expect(markup).not.toContain(">Generate summary</button>");
  });

  it("renders the normal action when idle", () => {
    const markup = renderToStaticMarkup(
      <SummaryGenerateButton loading={false} onClick={() => undefined} />
    );

    expect(markup).toContain("aria-busy=\"false\"");
    expect(markup).toContain("Generate summary");
    expect(markup).not.toContain("is-loading");
  });
});
