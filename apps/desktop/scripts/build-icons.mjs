import sharp from "sharp";
import pngToIco from "png-to-ico";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const source = resolve(root, "public/brand/pilot-princess-mark.svg");
const output = resolve(root, "apps/desktop/build");
await mkdir(output, { recursive: true });
const pngPath = resolve(output, "icon.png");
await sharp(source).resize(1024, 1024, { fit: "contain", background: { r: 17, g: 19, b: 21, alpha: 0 } }).png().toFile(pngPath);
const icoInputs = await Promise.all([16, 24, 32, 48, 64, 128, 256].map((size) => sharp(source).resize(size, size).png().toBuffer()));
await writeFile(resolve(output, "icon.ico"), await pngToIco(icoInputs));
