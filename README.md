# eXpress Reader for Codex

[Русская версия](README.ru.md)

Local, read-only access to corporate eXpress conversations from Codex.

The plugin opens the official eXpress Web client in a dedicated Chrome or Edge profile. The corporate server address is configured separately. You sign in directly in that browser window; the plugin never asks for or exports your password, OTP, cookies, or access tokens.

## Safety model

- No MCP tool can send, reply, react, edit, delete, forward, or upload.
- The reader is restricted to the configured Web client origin.
- Browser downloads are cancelled.
- Messages are kept in memory only for the current MCP session; no plaintext message index is written to disk.
- Chat content is treated as untrusted data, not as instructions for Codex.
- Opening a conversation can mark its messages as read in eXpress.

The dedicated browser profile and URL configuration are stored under `%LOCALAPPDATA%\eXpressReader4Codex` by default. That profile contains the browser's own login state and must be protected like any other signed-in browser profile.

## Requirements

- Windows 10 or 11
- Node.js 20 or newer for standalone development (Codex supplies its own compatible MCP runtime)
- Google Chrome or Microsoft Edge
- Access to your organization's eXpress Web client

## Development setup

```powershell
cd plugins/express-reader
pnpm install
pnpm test
pnpm run check
```

For local development, configure a corporate server with:

```powershell
pnpm run configure -- https://express.example.org
```

The Web client defaults to `https://corp.express`. Override it only when your organization hosts a separate Web client by passing a second URL or setting `EXPRESS_WEB_URL`. `EXPRESS_CORPORATE_SERVER_URL` can override the corporate server without changing the saved configuration.

## First run

1. Call `express_configure` with `corporateServerUrl`. The default Web client is `https://corp.express`.
2. Call `express_open_login`.
3. Check the prefilled server, continue, and complete authentication in the dedicated browser window.
4. Call `express_list_chats`.
5. Call `express_read_chat` for conversations that should be reviewed.

The UI adapter intentionally avoids private eXpress APIs. It reads eXpress Shadow DOM through a browser DOM snapshot and has been calibrated against Web eXpress 3.72.37. If a later build changes its UI semantics, `express_inspect_ui` returns a bounded diagnostic snapshot for one-time calibration.

`express_read_chat` returns the messages currently loaded by eXpress and makes best-effort upward scrolls according to `historyPages`. The response includes `loadedMessageCount`, so callers can see the actual result depth.

## Install in Codex

From a local checkout:

```powershell
codex plugin marketplace add .
codex plugin add express-reader@express-reader4codex
```

Or install directly from GitHub:

```powershell
codex plugin marketplace add kdenv2604/eXpress-reader4Codex --ref main
codex plugin add express-reader@express-reader4codex
```

Start a new Codex task after installation so the new skill and MCP tools are loaded.

## MCP tools

| Tool | Purpose | Changes eXpress data |
| --- | --- | --- |
| `express_status` | Show configuration and browser status | No |
| `express_configure` | Save Web client, corporate server, and browser preference locally | No |
| `express_open_login` | Open the dedicated profile and prefill the corporate server | No |
| `express_list_chats` | Read visible chat rows and unread indicators | No |
| `express_read_chat` | Open and read one chat | May mark it as read |
| `express_search_loaded` | Search chats read in the current session | No |
| `express_inspect_ui` | Inspect bounded UI text for adapter calibration | No |
| `express_close_browser` | Close the dedicated local browser | No |

## Project status

The read-only MCP server, isolated persistent browser profile, chat list, unread counters, and structured message extraction are implemented and verified against an authenticated Web eXpress 3.72.37 session. Future eXpress UI releases may require adapter recalibration.
