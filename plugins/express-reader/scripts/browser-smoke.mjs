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
          .tabs { display:flex; gap:8px; padding:8px }
          .tab--selected { font-weight:bold }
          .chat-list-entry { display:block; width:300px; height:64px; text-align:left }
          .messages { height:100vh; overflow-y:auto; padding:20px }
          .chat-message-row { min-height:80px }
        </style>
        <div class="app">
          <aside>
            <nav class="tabs">
              <button id="all-tab" class="tab tab--selected">\u0412\u0441\u0435 \u0447\u0430\u0442\u044b</button>
              <button id="threads-tab" class="tab">\u041e\u0431\u0441\u0443\u0436\u0434\u0435\u043d\u0438\u044f</button>
            </nav>
            <div id="chat-list"></div>
          </aside>
          <main id="content" class="infinite-scroll infinite-scroll--chat messages">
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

      const allTab = root.querySelector("#all-tab");
      const threadsTab = root.querySelector("#threads-tab");
      const chatList = root.querySelector("#chat-list");
      const content = root.querySelector("#content");
      const initialMessages = content.innerHTML;

      const selectTab = (selected) => {
        allTab.classList.toggle("tab--selected", selected === allTab);
        threadsTab.classList.toggle("tab--selected", selected === threadsTab);
      };
      const renderChats = () => {
        selectTab(allTab);
        chatList.innerHTML = \`
          <button class="row chat-list-entry">
            <span>Alpha Team</span><span class="chat-list-entry__time chat-list-entry__time--unread">08:05</span>
            <span>Two unread messages</span><span class="row chat-list-entry-counter">2</span>
          </button>
          <button class="row chat-list-entry"><span>Release Room</span><span>08:04</span><span>Build passed</span></button>
        \`;
        content.innerHTML = initialMessages;
      };
      const renderThreads = () => {
        selectTab(threadsTab);
        chatList.innerHTML = \`
          <button id="release-thread" class="row chat-list-entry" data-shared-history="true">
            <span>Release Room</span><span>09:00</span><span>Release discussion</span>
            <span>Alice:</span><span>The rollout is ready.</span>
          </button>
        \`;
        root.querySelector("#release-thread").addEventListener("click", () => {
          content.innerHTML = \`
            <header class="chat-header" data-chat-type="thread">
              <button id="close-thread" type="button" aria-label="Back">Back</button>
              <span>Release discussion</span>
            </header>
            <article class="chat-message-row chat-message-row--opponent">
              <span class="chat-message__title-text">Alice</span>
              <p class="chat-message__text">Release discussion</p>
              <time class="chat-message__timestamp" title="10.09.2026, 08:55:00">08:55</time>
            </article>
            <article class="chat-message-row chat-message-row--opponent">
              <span class="chat-message__title-text">Bob</span>
              <p class="chat-message__text">The rollout is ready.</p>
              <time class="chat-message__timestamp" title="10.09.2026, 09:00:00">09:00</time>
            </article>
          \`;
          root.querySelector("#close-thread").addEventListener("click", () => {
            content.innerHTML = initialMessages;
            renderThreads();
          });
        });
      };

      allTab.addEventListener("click", renderChats);
      threadsTab.addEventListener("click", renderThreads);
      renderChats();
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
  const { closeThread, listChats, listThreads, readChat, readThread } = await import("../src/ui-reader.mjs");
  const browser = new BrowserSession();

  try {
    const page = await browser.pageForReading();
    const chats = await listChats(page, 10);
    assert.equal(chats.detection, "express-dom-snapshot");
    assert.ok(chats.chats.some((chat) => chat.title === "Alpha Team" && chat.unread));

    const thread = await readChat(page, "Alpha Team", 1, 10, () => browser.assertPageAllowed(page));
    assert.equal(thread.detection, "express-dom-snapshot");
    assert.ok(thread.messages.some((message) => message.text.includes("review the release")));

    const discussions = await listThreads(page, 10);
    assert.equal(discussions.detection, "express-dom-snapshot");
    assert.ok(discussions.threads.some((item) =>
      item.chatTitle === "Release Room" && item.topic === "Release discussion"));

    const discussion = await readThread(page, {
      query: "Release discussion",
      historyPages: 1,
      messageLimit: 10,
      closeAfter: true,
    }, () => browser.assertPageAllowed(page));
    assert.equal(discussion.parent.text, "Release discussion");
    assert.ok(discussion.messages.some((message) => message.text === "The rollout is ready."));
    assert.equal(discussion.closedAfterRead, true);

    const cleanup = await closeThread(page);
    assert.equal(cleanup.closed, false);
    assert.equal(cleanup.reason, "no-thread-open");
    process.stdout.write("Browser smoke test passed.\n");
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
