import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_DATA_DIR = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "eXpressReader4Codex",
);

export const DEFAULT_WEB_URL = "https://corp.express";

export function getDataDir() {
  return path.resolve(process.env.EXPRESS_READER_DATA_DIR || DEFAULT_DATA_DIR);
}

export function normalizeWebUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The eXpress URL must use http or https.");
  }
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function loadConfig() {
  const configPath = path.join(getDataDir(), "config.json");
  let saved = {};

  try {
    saved = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Cannot read ${configPath}: ${error.message}`);
    }
  }

  const webUrl = process.env.EXPRESS_WEB_URL || saved.webUrl || DEFAULT_WEB_URL;
  const corporateServerUrl = process.env.EXPRESS_CORPORATE_SERVER_URL || saved.corporateServerUrl;
  return {
    webUrl: normalizeWebUrl(webUrl),
    corporateServerUrl: corporateServerUrl ? normalizeWebUrl(corporateServerUrl) : null,
    browser: process.env.EXPRESS_BROWSER || saved.browser || "chrome",
    headless: process.env.EXPRESS_BROWSER_HEADLESS === "1" || saved.headless === true,
    dataDir: getDataDir(),
    configPath,
  };
}

export async function saveConfig(update) {
  const current = await loadConfig();
  const next = {
    webUrl: update.webUrl ? normalizeWebUrl(update.webUrl) : current.webUrl,
    corporateServerUrl: update.corporateServerUrl
      ? normalizeWebUrl(update.corporateServerUrl)
      : current.corporateServerUrl,
    browser: update.browser || current.browser,
    headless: update.headless ?? current.headless,
  };

  await fs.mkdir(current.dataDir, { recursive: true });
  const temporaryPath = `${current.configPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, current.configPath);
  return loadConfig();
}
