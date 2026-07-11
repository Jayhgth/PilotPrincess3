import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AssistantMarkdown from "@/components/AssistantMarkdown";

describe("assistant markdown", () => {
  it("renders GFM structure and safe external links", () => {
    const html = renderToStaticMarkup(createElement(AssistantMarkdown, { text: `## Plan

- [x] Verify transcript
- Compare **two options**

| Course | Units |
| --- | ---: |
| MATH 200 | 5 |

~~Old note~~ and [official source](https://example.edu/catalog).

\`\`\`ts
const units = 5;
\`\`\`

<script>alert("no")</script>` }));

    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain("<table>");
    expect(html).toContain("type=\"checkbox\"");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("<del>Old note</del>");
    expect(html).toContain("<pre><code class=\"language-ts\"");
    expect(html).toContain("target=\"_blank\"");
    expect(html).toContain("rel=\"noopener noreferrer\"");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(&quot;no&quot;)");
  });
});
