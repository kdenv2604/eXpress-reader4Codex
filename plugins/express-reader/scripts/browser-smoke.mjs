import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>eXpress Reader smoke</title></head>
  <body style="margin:0"><express-fixture></express-fixture>
    <script>
      const root = document.querySelector("express-fixture").attachShadow({ mode: "closed" });
      root.innerHTML = \`
        <style>
          .app { display:grid; grid-template-columns:320px 1fr; height:100vh }
          .chat-list-entry { display:block; width:300px; height:64px; text-align:left }
          .messages { height:100vh; overflow-y:auto; padding:20px }
          .chat-message-row { min-height:80px }
        </style>
        <div class="app">
          <aside>
            <button class="row chat-list-entry">
              <span>Alpha Team</span><span class="chat-list-entry__time chat-list-entry__time--unread">08:05</span>
              <span>Two unread messages</span><span class="row chat-list-entry-counter">2</span>
            </button>
            <button class="row chat-list-entry"><span>Release Room</span><span>08:04</span><span>Build passed</span></button>
          </aside>
          <main class="infinite-scroll infinite-scroll--chat messages">
            <article class="chat-message-row chat-message-row--opponent">
              <span class="chat-message__title-text">Alice</span>
              <p class="chat-message__text">Can you review the release?</p>
              <time class="chat-message__timestamp" title="10.09.2026, 08:00:00">08:00</time>
            </article>
            <article class="chat-message-row chat-message-row--opponent">
              <span class="chat-message__title-text">Bob</span>
              <p class="chat-message__text">The build is ready.</p>
              <time class="chat-message__timestamp" title="10.09.2026, 08:05:00">08:05</time>
            </article>
          </main>
        </div>\`;
    </script>
  </body>
</html>`;

const dataDir = await mkdtemp(path.join(os.tmpdir(), "express-reader-smoke-"));
const server = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});

try {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  process.env.EXPRESS_WEB_URL = `http://127.0.0.1:${address.port}`;
  process.env.EXPRESS_READER_DATA_DIR = dataDir;
  process.env.EXPRESS_BROWSER_HEADLESS = "1";

  const { BrowserSession } = await import("../src/browser-session.mjs");
  const { listChats, readChat } = await import("../src/ui-reader.mjs");
  const browser = new BrowserSession();

  try {
    const page = await browser.pageForReading();
    const chats = await listChats(page, 10);
    assert.equal(chats.detection, "express-dom-snapshot");
    assert.ok(chats.chats.some((chat) => chat.title === "Alpha Team" && chat.unread));

    const thread = await readChat(page, "Alpha Team", 1, 10, () => browser.assertPageAllowed(page));
    assert.equal(thread.detection, "express-dom-snapshot");
    assert.ok(thread.messages.some((message) => message.text.includes("review the release")));
    process.stdout.write("Browser smoke test passed.\n");
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
