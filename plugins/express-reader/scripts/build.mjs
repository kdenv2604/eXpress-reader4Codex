import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const projectDir = fileURLToPath(new URL("..", import.meta.url));
const playwrightDir = path.dirname(require.resolve("playwright-core/package.json"));

await mkdir(path.join(projectDir, "dist"), { recursive: true });
await build({
  entryPoints: [path.join(projectDir, "src", "server.mjs")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  minifyWhitespace: true,
  external: ["chromium-bidi/*"],
  outfile: path.join(projectDir, "dist", "server.cjs"),
});
await copyFile(
  path.join(playwrightDir, "browsers.json"),
  path.join(projectDir, "browsers.json"),
);

process.stdout.write("Built dist/server.cjs and copied Playwright runtime assets.\n");
