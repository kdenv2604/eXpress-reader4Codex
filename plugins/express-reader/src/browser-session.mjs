import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { loadConfig } from "./config.mjs";

const WINDOWS_BROWSER_PATHS = {
  chrome: [
    [process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"],
    [process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"],
    [process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"],
  ],
  edge: [
    [process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"],
    [process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"],
    [process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"],
  ],
};

async function findBrowserExecutable(preference) {
  const order = preference === "edge" ? ["edge", "chrome"] : ["chrome", "edge"];
  for (const browser of order) {
    for (const segments of WINDOWS_BROWSER_PATHS[browser]) {
      if (!segments[0]) continue;
      const candidate = path.join(...segments);
      try {
        await access(candidate);
        return { browser, executablePath: candidate };
      } catch {
        // Try the next known installation path.
      }
    }
  }
  throw new Error("Google Chrome or Microsoft Edge was not found.");
}

function sameOrigin(candidate, configuredUrl) {
  try {
    return new URL(candidate).origin === new URL(configuredUrl).origin;
  } catch {
    return false;
  }
}

export class BrowserSession {
  #context = null;
  #browserInfo = null;

  async status() {
    const config = await loadConfig();
    const pages = this.#context?.pages() || [];
    const expressPage = config.webUrl
      ? pages.find((page) => sameOrigin(page.url(), config.webUrl))
      : null;

    return {
      configured: Boolean(config.webUrl),
      webUrl: config.webUrl,
      corporateServerUrl: config.corporateServerUrl,
      browserPreference: config.browser,
      browserRunning: Boolean(this.#context),
      browserExecutable: this.#browserInfo?.executablePath || null,
      expressPageOpen: Boolean(expressPage),
      currentUrl: expressPage?.url() || null,
      dataDir: config.dataDir,
      profileDir: path.join(config.dataDir, "browser-profile"),
    };
  }

  async open() {
    const config = await loadConfig();
    if (!config.webUrl) {
      throw new Error("eXpress is not configured. Call express_configure with the web URL first.");
    }

    const page = await this.#getOrCreatePage(config);
    if (!sameOrigin(page.url(), config.webUrl)) {
      await page.goto(config.webUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    this.#assertAllowed(page.url(), config.webUrl);
    await page.bringToFront();
    return page;
  }

  async pageForReading() {
    const config = await loadConfig();
    if (!config.webUrl) {
      throw new Error("eXpress is not configured. Call express_configure with the web URL first.");
    }

    const page = await this.#getOrCreatePage(config);
    if (!sameOrigin(page.url(), config.webUrl)) {
      await page.goto(config.webUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    }
    this.#assertAllowed(page.url(), config.webUrl);
    return page;
  }

  async close() {
    await this.#context?.close();
    this.#context = null;
    this.#browserInfo = null;
  }

  async #getOrCreatePage(config) {
    if (!this.#context) {
      await mkdir(config.dataDir, { recursive: true });
      const profileDir = path.join(config.dataDir, "browser-profile");
      this.#browserInfo = await findBrowserExecutable(config.browser);
      this.#context = await chromium.launchPersistentContext(profileDir, {
        executablePath: this.#browserInfo.executablePath,
        headless: config.headless,
        chromiumSandbox: true,
        viewport: null,
        acceptDownloads: false,
        args: ["--start-maximized"],
      });

      const cancelDownloads = (page) => {
        page.on("download", (download) => void download.cancel());
      };
      this.#context.pages().forEach(cancelDownloads);
      this.#context.on("page", cancelDownloads);
    }

    const pages = this.#context.pages();
    const existing = pages.find((page) => sameOrigin(page.url(), config.webUrl));
    return existing || pages[0] || this.#context.newPage();
  }

  #assertAllowed(currentUrl, configuredUrl) {
    if (!sameOrigin(currentUrl, configuredUrl)) {
      throw new Error(`Refusing to read outside the configured eXpress origin: ${currentUrl}`);
    }
  }

  async assertPageAllowed(page) {
    const config = await loadConfig();
    this.#assertAllowed(page.url(), config.webUrl);
  }
}
