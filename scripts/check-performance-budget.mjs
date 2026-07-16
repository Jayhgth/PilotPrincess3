import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";

const assetDirectory = new URL("../dist/client/_astro/", import.meta.url);
const files = await readdir(assetDirectory);
const javascript = files.filter((file) => file.endsWith(".js"));
const sizes = await Promise.all(javascript.map(async (file) => {
  const bytes = await readFile(new URL(file, assetDirectory));
  return { file, gzipBytes: gzipSync(bytes).byteLength };
}));

const largest = sizes.toSorted((left, right) => right.gzipBytes - left.gzipBytes)[0];
const total = sizes.reduce((sum, asset) => sum + asset.gzipBytes, 0);
const maximumChunk = Number(process.env.MAX_CLIENT_CHUNK_GZIP_BYTES ?? 80_000);
const maximumTotal = Number(process.env.MAX_CLIENT_JS_GZIP_BYTES ?? 750_000);

console.log(`Client JavaScript: ${javascript.length} chunks, ${Math.round(total / 1024)} KiB gzip total, largest ${largest ? `${largest.file} (${Math.round(largest.gzipBytes / 1024)} KiB)` : "none"}.`);
if (largest && largest.gzipBytes > maximumChunk) {
  throw new Error(`Largest client chunk exceeds the ${Math.round(maximumChunk / 1024)} KiB gzip budget.`);
}
if (total > maximumTotal) {
  throw new Error(`Total client JavaScript exceeds the ${Math.round(maximumTotal / 1024)} KiB gzip budget.`);
}
