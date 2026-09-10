import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TOOL_CONTRACT } from "../src/tool-contract.mjs";

const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>eXpress Reader MCP smoke</title></head>
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

const dataDir = await mkdtemp(path.join(os.tmpdir(), "express-reader-mcp-smoke-"));
const fixtureServer = createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});

await new Promise((resolve, reject) => {
  fixtureServer.once("error", reject);
  fixtureServer.listen(0, "127.0.0.1", resolve);
});
const fixtureAddress = fixtureServer.address();
const fixtureUrl = `http://127.0.0.1:${fixtureAddress.port}`;

const child = spawn(
  "cmd.exe",
  ["/d", "/s", "/c", "call", ".\\scripts\\launch-express-reader.cmd"],
  {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      CODEX_MCP_NODE_PATH: process.execPath,
      EXPRESS_WEB_URL: fixtureUrl,
      EXPRESS_READER_DATA_DIR: dataDir,
      EXPRESS_BROWSER_HEADLESS: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);

let stdoutBuffer = "";
let stderr = "";
const received = new Map();
const waiting = new Map();
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");

function deliver(message) {
  const waiter = waiting.get(message.id);
  if (waiter) {
    waiting.delete(message.id);
    clearTimeout(waiter.timeout);
    waiter.resolve(message);
  } else if (message.id !== undefined) {
    received.set(message.id, message);
  }
}

child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  let newline = stdoutBuffer.indexOf("\n");
  while (newline >= 0) {
    const line = stdoutBuffer.slice(0, newline).trim();
    stdoutBuffer = stdoutBuffer.slice(newline + 1);
    if (line) deliver(JSON.parse(line));
    newline = stdoutBuffer.indexOf("\n");
  }
});
child.stderr.on("data", (chunk) => { stderr += chunk; });

function waitForResponse(id, timeoutMs = 30_000) {
  const existing = received.get(id);
  if (existing) {
    received.delete(id);
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`MCP response ${id} timed out. stderr: ${stderr}`));
    }, timeoutMs);
    waiting.set(id, { resolve, reject, timeout });
  });
}

function request(id, method, params) {
  const response = waitForResponse(id);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return response;
}

function payload(message) {
  assert.equal(message.error, undefined, JSON.stringify(message.error));
  assert.notEqual(message.result?.isError, true, message.result?.content?.[0]?.text);
  return message.result?.structuredContent || JSON.parse(message.result.content[0].text);
}

try {
  await request(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "express-reader-smoke", version: "0.1.0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const tools = await request(2, "tools/list", {});
  assert.deepEqual(
    tools.result.tools.map((tool) => tool.name).sort(),
    TOOL_CONTRACT.map((tool) => tool.name).sort(),
  );

  const chatList = payload(await request(3, "tools/call", {
    name: "express_list_chats",
    arguments: { limit: 10 },
  }));
  assert.ok(chatList.chats.some((chat) => chat.title === "Alpha Team" && chat.unread));

  const thread = payload(await request(4, "tools/call", {
    name: "express_read_chat",
    arguments: { title: "Alpha Team", historyPages: 1, messageLimit: 10 },
  }));
  assert.ok(thread.messages.some((message) => message.text.includes("review the release")));

  payload(await request(5, "tools/call", {
    name: "express_close_browser",
    arguments: {},
  }));
  process.stdout.write("MCP bundle smoke test passed.\n");
} finally {
  child.stdin.end();
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill();
  await new Promise((resolve) => fixtureServer.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
