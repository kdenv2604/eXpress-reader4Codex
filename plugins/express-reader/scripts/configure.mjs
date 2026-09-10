import { DEFAULT_WEB_URL, saveConfig } from "../src/config.mjs";

const corporateServerUrl = process.argv[2];
const webUrl = process.argv[3] || DEFAULT_WEB_URL;

if (!corporateServerUrl) {
  process.stderr.write("Usage: node scripts/configure.mjs <corporate-server-url> [web-client-url]\n");
  process.exit(2);
}

const config = await saveConfig({ corporateServerUrl, webUrl });
process.stdout.write(`Configured eXpress Web client: ${new URL(config.webUrl).origin}\n`);
process.stdout.write(`Configured corporate server: ${new URL(config.corporateServerUrl).origin}\n`);
