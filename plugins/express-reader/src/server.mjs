import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { ExpressReader } from "./reader.mjs";

const reader = new ExpressReader();

function result(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function imageResult(value) {
  const { data, mimeType, ...metadata } = value;
  return {
    content: [
      { type: "text", text: JSON.stringify(metadata, null, 2) },
      { type: "image", data, mimeType },
    ],
    structuredContent: metadata,
  };
}

function failure(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
  };
}

function safely(handler) {
  return async (input) => {
    try {
      return result(await handler(input));
    } catch (error) {
      return failure(error);
    }
  };
}

function safelyImage(handler) {
  return async (input) => {
    try {
      return imageResult(await handler(input));
    } catch (error) {
      return failure(error);
    }
  };
}

export function createServer() {
  const server = new McpServer({ name: "express-reader", version: "0.1.0" });

  server.registerTool(
    "express_status",
    {
      description: "Show local eXpress reader configuration and browser status. Does not open a chat.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safely(() => reader.status()),
  );

  server.registerTool(
    "express_configure",
    {
      description: "Save the eXpress Web client URL, corporate server URL, and browser choice locally. Stores no credentials.",
      inputSchema: z.object({
        corporateServerUrl: z.string().url().optional(),
        webUrl: z.string().url().optional(),
        browser: z.enum(["chrome", "edge"]).optional(),
        headless: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safely((input) => reader.configure(input)),
  );

  server.registerTool(
    "express_open_login",
    {
      description: "Open eXpress Web in a dedicated browser profile and prefill the configured corporate server. Never accepts credentials or submits the login form.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safely(() => reader.openLogin()),
  );

  server.registerTool(
    "express_list_chats",
    {
      description: "Read visible eXpress chat rows and unread indicators. Does not send, edit, react, or delete.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(300).default(100),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safely(({ limit }) => reader.listChats(limit)),
  );

  server.registerTool(
    "express_list_threads",
    {
      description: "List visible eXpress discussions with their source chat, topic, update time, and latest preview. Restores the previous chat-list tab afterward.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(300).default(100),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safely(({ limit }) => reader.listThreads(limit)),
  );

  server.registerTool(
    "express_read_chat",
    {
      description: "Open and read one eXpress chat. This cannot send content, but opening the chat may mark messages as read.",
      inputSchema: z.object({
        title: z.string().min(1),
        historyPages: z.number().int().min(1).max(20).default(4),
        messageLimit: z.number().int().min(1).max(1000).default(200),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safely(({ title, historyPages, messageLimit }) => reader.readChat(title, historyPages, messageLimit)),
  );

  server.registerTool(
    "express_read_thread",
    {
      description: "Find an eXpress discussion by topic text, open it, read its messages, and close it afterward by default. Opening a thread may mark its messages as read.",
      inputSchema: z.object({
        query: z.string().min(1),
        chatTitle: z.string().min(1).optional(),
        historyPages: z.number().int().min(1).max(20).default(4),
        messageLimit: z.number().int().min(1).max(1000).default(200),
        closeAfter: z.boolean().default(true),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safely((input) => reader.readThread(input)),
  );

  server.registerTool(
    "express_read_image",
    {
      description: "Open a specific eXpress chat or discussion, find a message by text and optional sender, and return one rendered inline image. This is read-only but may mark messages as read. It does not return attachment URLs, cookies, or tokens.",
      inputSchema: z.object({
        chatTitle: z.string().min(1),
        threadQuery: z.string().min(1).optional(),
        messageQuery: z.string().min(1),
        sender: z.string().min(1).optional(),
        imageIndex: z.number().int().min(0).max(20).default(0),
        historyPages: z.number().int().min(1).max(20).default(4),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safelyImage((input) => reader.readImage(input)),
  );

  server.registerTool(
    "express_close_thread",
    {
      description: "Close the currently open eXpress discussion and restore the main chat list. Does not send or modify messages.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safely(() => reader.closeThread()),
  );

  server.registerTool(
    "express_search_loaded",
    {
      description: "Search messages already read during the current MCP session. No message cache is written to disk.",
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safely(({ query, limit }) => reader.searchLoaded(query, limit)),
  );

  server.registerTool(
    "express_inspect_ui",
    {
      description: "Return a bounded DOM and accessibility snapshot for calibrating the UI adapter. It performs no clicks or typing.",
      inputSchema: z.object({
        maxChars: z.number().int().min(1000).max(100_000).default(30_000),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    safely(({ maxChars }) => reader.inspectUi(maxChars)),
  );

  server.registerTool(
    "express_close_browser",
    {
      description: "Close the dedicated local eXpress browser. Does not sign out or change messenger data.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    safely(() => reader.closeBrowser()),
  );

  return server;
}

async function shutdown() {
  await reader.close();
  process.exit(0);
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  console.error("eXpress Reader MCP server is ready on stdio");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
