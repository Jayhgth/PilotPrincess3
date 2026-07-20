import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const failures = [];

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function fail(message) {
  failures.push(message);
}

const trackedFiles = git(["ls-files", "-z"]).split("\0").filter(Boolean);
const repositoryFiles = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
const trackedEnvironmentFiles = trackedFiles.filter((file) => /(^|\/)\.env(?:\.|$)/.test(file));
if (trackedEnvironmentFiles.some((file) => file !== ".env.example")) {
  fail(`Tracked environment file: ${trackedEnvironmentFiles.filter((file) => file !== ".env.example").join(", ")}`);
}

try {
  git(["check-ignore", "-q", ".env"]);
} catch {
  fail(".env is not ignored by Git.");
}

const secretPatterns = [
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  /sb_secret_[A-Za-z0-9_-]{16,}/,
  /GOCSPX-[A-Za-z0-9_-]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /service_role[^\n]{0,80}eyJ[A-Za-z0-9_-]{20,}/i
];
for (const file of repositoryFiles) {
  if (file === "pnpm-lock.yaml") continue;
  let contents;
  try {
    contents = readFileSync(join(root, file), "utf8");
  } catch {
    continue;
  }
  if (secretPatterns.some((pattern) => pattern.test(contents))) fail(`Possible credential in ${file}`);
}

const migrationsDirectory = join(root, "supabase", "migrations");
const migrationSql = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => readFileSync(join(migrationsDirectory, file), "utf8"))
  .join("\n");
const createdTables = new Set(
  [...migrationSql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)/gi)].map((match) => match[1])
);
const rlsTables = new Set(
  [...migrationSql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z0-9_]+)\s+enable\s+row\s+level\s+security/gi)].map((match) => match[1])
);
const missingRls = [...createdTables].filter((table) => !rlsTables.has(table));
if (missingRls.length) fail(`Public tables without RLS migrations: ${missingRls.join(", ")}`);

const functionStarts = [...migrationSql.matchAll(/create(?:\s+or\s+replace)?\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi)];
const latestFunctions = new Map();
for (const [index, match] of functionStarts.entries()) {
  const next = functionStarts[index + 1];
  latestFunctions.set(match[1].toLowerCase(), migrationSql.slice(match.index, next?.index ?? migrationSql.length));
}
const unsafeDefiners = [...latestFunctions.entries()]
  .filter(([, block]) => /security\s+definer/i.test(block) && !/set\s+search_path\s*=\s*''/i.test(block))
  .map(([name]) => name);
if (unsafeDefiners.length) {
  fail(`Latest SECURITY DEFINER functions without an empty search path: ${unsafeDefiners.join(", ")}`);
}

for (const requiredContract of [
  "ensure_current_user_workspace_v1",
  "get_workspace_snapshot_v1",
  "acquire_assistant_turn_v1",
  "source-uploads",
  "ai-attachments"
]) {
  if (!migrationSql.includes(requiredContract)) fail(`Missing Supabase deployment contract: ${requiredContract}`);
}

const astroConfig = readFileSync(join(root, "astro.config.mjs"), "utf8");
if (!astroConfig.includes('from "@astrojs/vercel"')) fail("Astro is not configured with the Vercel adapter.");
if (!astroConfig.includes("maxDuration")) fail("Vercel function duration is not configured.");
if (!astroConfig.includes("codexRuntimeAssets")) fail("The native Codex runtime is not explicitly included in the Vercel function.");

const vercelConfig = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8"));
if (vercelConfig.framework !== "astro") fail("vercel.json must pin the Astro framework preset.");
if ("outputDirectory" in vercelConfig) fail("Do not override Vercel's output directory; the Astro adapter emits Build Output API routes.");
if (vercelConfig.buildCommand !== "pnpm build") fail("Vercel must run the repository's production build.");

const exampleEnvironment = readFileSync(join(root, ".env.example"), "utf8");
for (const requiredName of [
  "PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_ANON_KEY",
  "OPENAI_API_KEY",
  "CODEX_TIMEOUT_MS",
  "VERCEL_FUNCTION_MAX_DURATION",
  "VERCEL_SUPPORT_LARGE_FUNCTIONS"
]) {
  if (!exampleEnvironment.includes(`${requiredName}=`)) fail(`.env.example is missing ${requiredName}.`);
}

if (failures.length) {
  console.error("Deployment readiness failed:\n" + failures.map((message) => `- ${message}`).join("\n"));
  process.exit(1);
}

console.log(`Deployment readiness passed: ${createdTables.size} public tables have RLS, privileged functions pin an empty search path, required auth/storage contracts exist, and no repository credential pattern was found.`);
