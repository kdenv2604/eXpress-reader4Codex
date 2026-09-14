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
      HTMLCanvasElement.prototype.toDataURL = () => {
        throw new DOMException("Synthetic cross-origin image", "SecurityError");
      };
      const root = document.querySelector("express-fixture").attachShadow({ mode: "closed" });
      root.innerHTML = \`
        <style>
          .app { display:grid; grid-template-columns:320px 1fr; height:100vh }
          .tabs { display:flex; gap:8px; padding:8px }
          .tab--selected { font-weight:bold }
          .chat-list-entry { display:block; width:300px; height:64px; text-align:left }
          .messages { height:100vh; overflow-y:auto; padding:20px }
          .chat-message-row { min-height:80px }
          .attachment-image { display:block; width:160px; height:96px }
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
              <img class="attachment-image" alt="Deployment dashboard" width="160" height="96"
                src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22192%22%3E%3Crect width=%22320%22 height=%22192%22 fill=%22%230b6%22/%3E%3Ctext x=%2224%22 y=%22104%22 font-size=%2240%22 fill=%22white%22%3Eready%3C/text%3E%3C/svg%3E">
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
              <img class="attachment-image" alt="Rollout chart" width="160" height="96"
                src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22320%22 height=%22192%22%3E%3Crect width=%22320%22 height=%22192%22 fill=%22%23067%22/%3E%3Ctext x=%2224%22 y=%22104%22 font-size=%2240%22 fill=%22white%22%3Erollout%3C/text%3E%3C/svg%3E">
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
  const { closeThread, inspectUi, listChats, listThreads, readChat, readImageAttachment, readThread } = await import("../src/ui-reader.mjs");
  const browser = new BrowserSession();

  try {
    const page = await browser.pageForReading();
    const chats = await listChats(page, 10);
    assert.equal(chats.detection, "express-dom-snapshot");
    assert.ok(chats.chats.some((chat) => chat.title === "Alpha Team" && chat.unread));

    const thread = await readChat(page, "Alpha Team", 1, 10, () => browser.assertPageAllowed(page));
    assert.equal(thread.detection, "express-dom-snapshot");
    assert.ok(thread.messages.some((message) => message.text.includes("review the release")));
    assert.equal(
      thread.messages.find((message) => message.text.includes("build is ready"))?.attachments?.length,
      1,
    );
    const inspection = await inspectUi(page);
    assert.ok(inspection.domScrollerCandidates.some((candidate) =>
      candidate.className.includes("infinite-scroll--chat")));

    const image = await readImageAttachment(page, {
      chatTitle: "Alpha Team",
      messageQuery: "The build is ready",
      sender: "Bob",
      imageIndex: 0,
      historyPages: 1,
    }, () => browser.assertPageAllowed(page));
    assert.equal(image.mimeType, "image/png");
    assert.equal(image.message.sender, "Bob");
    assert.equal(image.image.width, 320);
    assert.equal(image.image.height, 192);
    assert.equal(image.image.captureMethod, "rendered-full-size");
    assert.ok(Buffer.from(image.data, "base64").byteLength > 100);

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

    const threadImage = await readImageAttachment(page, {
      chatTitle: "Release Room",
      threadQuery: "Release discussion",
      messageQuery: "The rollout is ready",
      sender: "Bob",
      imageIndex: 0,
      historyPages: 1,
    }, () => browser.assertPageAllowed(page));
    assert.equal(threadImage.mimeType, "image/png");
    assert.equal(threadImage.thread, "Release discussion");
    assert.ok(Buffer.from(threadImage.data, "base64").byteLength > 100);

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
