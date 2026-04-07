/**
 * Copy all .mdc files from .cursor/rules/ → cursor-rules/ (run before publish from repo root).
 * This ensures every cursor rule authored locally is included in the published package.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, ".cursor", "rules");
const destDir = path.join(root, "cursor-rules");

if (!fs.existsSync(srcDir)) {
  console.warn("sync-cursor-rule: source dir missing:", srcDir);
  process.exit(1);
}

const mdcFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".mdc"));
if (mdcFiles.length === 0) {
  console.warn("sync-cursor-rule: no .mdc files found in", srcDir);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });

for (const file of mdcFiles) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  console.log(`sync-cursor-rule: updated cursor-rules/${file}`);
}

console.log(`sync-cursor-rule: ${mdcFiles.length} rule(s) synced.`);
