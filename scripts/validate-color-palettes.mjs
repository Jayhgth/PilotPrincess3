import { readFile } from "node:fs/promises";

const palettes = JSON.parse(await readFile(new URL("../docs/color-palettes.json", import.meta.url), "utf8"));

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((value) => Number.parseInt(value, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

let failed = false;
for (const palette of palettes) {
  for (const mode of ["light", "dark"]) {
    const colors = palette[mode];
    const checks = {
      "body text": contrast(colors.text, colors.background),
      "muted text": contrast(colors.mutedText, colors.background),
      "primary action": contrast(colors.onPrimary, colors.primary),
      "college action": contrast(colors.onCollege, colors.college)
    };
    for (const [label, ratio] of Object.entries(checks)) {
      const pass = ratio >= 4.5;
      failed ||= !pass;
      console.log(`${pass ? "PASS" : "FAIL"} ${palette.name} ${mode} ${label}: ${ratio.toFixed(2)}:1`);
    }
  }
}

if (failed) process.exitCode = 1;
