import { spawn } from "node:child_process";

const env = {
  ...process.env,
  PILOT_DESKTOP: "true",
  CODEX_ALLOW_LOCAL_AUTH: "true",
  PILOT_DESKTOP_DEV_URL: "http://127.0.0.1:47831"
};
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const electron = process.platform === "win32" ? "node_modules\\.bin\\electron.cmd" : "node_modules/.bin/electron";
const web = spawn(pnpm, ["exec", "astro", "dev", "--host", "127.0.0.1", "--port", "47831"], { env, stdio: "inherit" });
const desktop = spawn(electron, ["apps/desktop/main.mjs"], { env, stdio: "inherit" });

function stop(code = 0) {
  web.kill();
  desktop.kill();
  process.exit(code);
}

web.once("exit", (code) => stop(code ?? 0));
desktop.once("exit", (code) => stop(code ?? 0));
process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
