import { BrowserSession } from "./browser-session.mjs";
import { loadConfig, saveConfig } from "./config.mjs";
import {
  closeThread,
  inspectUi,
  listChats,
  listThreads,
  prepareCorporateLogin,
  readChat,
  readImageAttachment,
  readThread,
} from "./ui-reader.mjs";

export class ExpressReader {
  #browser = new BrowserSession();
  #sessionMessages = new Map();

  async configure(input) {
    const config = await saveConfig(input);
    return {
      configured: Boolean(config.webUrl),
      webUrl: config.webUrl,
      corporateServerUrl: config.corporateServerUrl,
      browser: config.browser,
      headless: config.headless,
      configPath: config.configPath,
      storesCredentials: false,
    };
  }

  async status() {
    return {
      ...(await this.#browser.status()),
      loadedChats: this.#sessionMessages.size,
      messengerWriteTools: [],
    };
  }

  async openLogin() {
    const page = await this.#browser.open();
    const config = await loadConfig();
    const preparation = await prepareCorporateLogin(page, config.corporateServerUrl);
    return {
      opened: true,
      url: page.url(),
      title: await page.title(),
      preparation,
      instruction: "Complete login in the dedicated browser window. Credentials are not exposed to the plugin.",
    };
  }

  async inspectUi(maxChars) {
    return inspectUi(await this.#browser.pageForReading(), maxChars);
  }

  async listChats(limit) {
    return listChats(await this.#browser.pageForReading(), limit);
  }

  async listThreads(limit) {
    return listThreads(await this.#browser.pageForReading(), limit);
  }

  async readChat(title, historyPages, messageLimit) {
    const page = await this.#browser.pageForReading();
    const result = await readChat(
      page,
      title,
      historyPages,
      messageLimit,
      () => this.#browser.assertPageAllowed(page),
    );
    if (result.messages.length) this.#sessionMessages.set(title, result.messages);
    return result;
  }

  async readThread(input) {
    const page = await this.#browser.pageForReading();
    const result = await readThread(page, input, () => this.#browser.assertPageAllowed(page));
    if (result.messages.length) {
      this.#sessionMessages.set(
        `thread:${result.thread.chatTitle}:${result.thread.topic}`,
        result.messages,
      );
    }
    return result;
  }

  async readImage(input) {
    const page = await this.#browser.pageForReading();
    return readImageAttachment(page, input, () => this.#browser.assertPageAllowed(page));
  }

  async closeThread() {
    return closeThread(await this.#browser.pageForReading());
  }

  async searchLoaded(query, limit) {
    const normalizedQuery = query.toLocaleLowerCase();
    const matches = [];
    for (const [chat, messages] of this.#sessionMessages) {
      for (const message of messages) {
        if (!message.text.toLocaleLowerCase().includes(normalizedQuery)) continue;
        matches.push({ chat, ...message });
        if (matches.length >= limit) return { matches, scope: "loaded-this-session" };
      }
    }
    return { matches, scope: "loaded-this-session" };
  }

  async config() {
    return loadConfig();
  }

  async close() {
    await this.#browser.close();
  }

  async closeBrowser() {
    await this.close();
    return { closed: true };
  }
}
