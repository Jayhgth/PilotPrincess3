import react from "@astrojs/react";
import vercel from "@astrojs/vercel";
import { defineConfig } from "astro/config";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { arch, env, platform } from "node:process";
import { fileURLToPath } from "node:url";

const configuredMaxDuration = Number(env.VERCEL_FUNCTION_MAX_DURATION ?? 300);
const maxDuration = Number.isFinite(configuredMaxDuration)
  ? Math.min(800, Math.max(10, Math.round(configuredMaxDuration)))
  : 300;

const projectRoot = dirname(fileURLToPath(import.meta.url));
const codexSdkEntry = import.meta.resolve("@openai/codex-sdk");
const codexRequire = createRequire(codexSdkEntry);
const codexCliScript = codexRequire.resolve("@openai/codex/bin/codex.js");
const codexPlatformPackage = {
  "darwin-arm64": "@openai/codex-darwin-arm64",
  "darwin-x64": "@openai/codex-darwin-x64",
  "linux-arm64": "@openai/codex-linux-arm64",
  "linux-x64": "@openai/codex-linux-x64",
  "win32-arm64": "@openai/codex-win32-arm64",
  "win32-x64": "@openai/codex-win32-x64"
}[`${platform}-${arch}`];

if (!codexPlatformPackage) {
  throw new Error(`Unsupported Codex deployment target: ${platform}-${arch}`);
}

const codexPlatformRoot = dirname(codexRequire.resolve(`${codexPlatformPackage}/package.json`));
const fromProjectRoot = (path) => relative(projectRoot, resolve(path));
const codexRuntimeAssets = [
  fromProjectRoot(codexCliScript),
  `${fromProjectRoot(codexPlatformRoot)}/**/*`
];

export default defineConfig({
  adapter: vercel({
    maxDuration,
    skewProtection: true
  }),
  integrations: [react()],
  output: "server",
  security: {
    checkOrigin: true
  },
  vite: {
    // The Codex SDK resolves its native executable dynamically, so Vercel's
    // static dependency tracer needs these runtime assets explicitly.
    assetsInclude: codexRuntimeAssets,
    server: {
      allowedHosts: ["localhost", "127.0.0.1"]
    }
  }
});
