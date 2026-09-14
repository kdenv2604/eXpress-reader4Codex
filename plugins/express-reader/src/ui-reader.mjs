const CHAT_SELECTORS = [
  '[data-testid*="chat" i]',
  '[data-qa*="chat" i]',
  '[class*="chat-item" i]',
  '[class*="chatitem" i]',
  '[role="listitem"]',
  '[role="treeitem"]',
  'button',
];

const MESSAGE_SELECTORS = [
  '[data-testid*="message" i]',
  '[data-qa*="message" i]',
  '[class*="message-item" i]',
  '[class*="messageitem" i]',
  '[role="article"]',
];

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function quadToRect(quad) {
  if (!quad?.length) return null;
  const xs = quad.filter((_, index) => index % 2 === 0);
  const ys = quad.filter((_, index) => index % 2 === 1);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(Math.max(...xs) - x),
    height: Math.round(Math.max(...ys) - y),
  };
}

function decodeAttributes(encoded, strings) {
  const attributes = {};
  for (let index = 0; index < (encoded?.length || 0); index += 2) {
    attributes[strings[encoded[index]]] = strings[encoded[index + 1]];
  }
  return attributes;
}

async function domSnapshotElements(page, predicate, limit = 100, textLimit = 600) {
  const session = await page.context().newCDPSession(page);
  try {
    const snapshot = await session.send("DOMSnapshot.captureSnapshot", {
      computedStyles: [],
      includeDOMRects: true,
      includePaintOrder: true,
    });
    const document = snapshot.documents[0];
    if (!document) return [];

    const { nodes, layout } = document;
    const children = Array.from({ length: nodes.nodeType.length }, () => []);
    const layoutBounds = new Map(
      layout.nodeIndex.map((nodeIndex, index) => [nodeIndex, layout.bounds[index]]),
    );
    nodes.parentIndex.forEach((parent, index) => {
      if (parent >= 0) children[parent].push(index);
    });

    const textOf = (root) => {
      const output = [];
      const pending = [...children[root]];
      while (pending.length) {
        const index = pending.shift();
        if (nodes.nodeType[index] === 3) output.push(snapshot.strings[nodes.nodeValue[index]] || "");
        pending.push(...children[index]);
      }
      return normalizeText(output.join("\n"));
    };

    const metadataOf = (root) => {
      const labels = [];
      const classNames = [];
      const images = [];
      const parts = {};
      const pending = [root];
      while (pending.length) {
        const index = pending.shift();
        if (nodes.nodeType[index] === 1) {
          const attributes = decodeAttributes(nodes.attributes[index], snapshot.strings);
          const nodeName = (snapshot.strings[nodes.nodeName[index]] || "").toLocaleLowerCase();
          for (const label of [attributes.alt, attributes["aria-label"], attributes.title]) {
            if (label) labels.push(normalizeText(label));
          }
          if (nodeName === "img") {
            const bounds = layoutBounds.get(index);
            if (bounds) {
              const [x, y, width, height] = bounds;
              images.push({
                backendDOMNodeId: nodes.backendNodeId[index],
                alt: normalizeText(attributes.alt) || null,
                ariaLabel: normalizeText(attributes["aria-label"]) || null,
                title: normalizeText(attributes.title) || null,
                className: attributes.class || null,
                rect: {
                  x: Math.round(x),
                  y: Math.round(y),
                  width: Math.round(width),
                  height: Math.round(height),
                },
              });
            }
          }
          if (attributes.class) {
            classNames.push(attributes.class);
            for (const token of attributes.class.split(/\s+/)) {
              if (!["chat-message__title-text", "chat-message__timestamp", "chat-message__text", "chat-message__content"].includes(token)) continue;
              const partText = textOf(index);
              if (!partText) continue;
              parts[token] ||= [];
              if (!parts[token].includes(partText)) parts[token].push(partText.slice(0, textLimit));
            }
          }
        }
        pending.push(...children[index]);
      }
      return {
        labels: [...new Set(labels.filter(Boolean))],
        classNames: [...new Set(classNames.filter(Boolean))],
        images,
        parts,
      };
    };

    const candidates = [];
    for (let layoutIndex = 0; layoutIndex < layout.nodeIndex.length; layoutIndex += 1) {
      const nodeIndex = layout.nodeIndex[layoutIndex];
      if (nodes.nodeType[nodeIndex] !== 1) continue;
      const [x, y, width, height] = layout.bounds[layoutIndex];
      const attributes = decodeAttributes(nodes.attributes[nodeIndex], snapshot.strings);
      if (!predicate({ attributes, x, y, width, height })) continue;
      const text = textOf(nodeIndex);
      const metadata = metadataOf(nodeIndex);
      if (!text && !metadata.images.length) continue;
      candidates.push({
        backendDOMNodeId: nodes.backendNodeId[nodeIndex],
        nodeName: snapshot.strings[nodes.nodeName[nodeIndex]].toLocaleLowerCase(),
        role: attributes.role || null,
        className: attributes.class || null,
        ariaLabel: attributes["aria-label"] || null,
        ...metadata,
        rect: {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        },
        text: text.slice(0, textLimit),
      });
      if (candidates.length >= limit) break;
    }
    return candidates;
  } finally {
    await session.detach();
  }
}

async function domChatCandidates(page, limit = 100) {
  return domSnapshotElements(
    page,
    ({ attributes }) => attributes.class?.split(/\s+/).includes("chat-list-entry"),
    limit,
  );
}

async function domTabCandidates(page, limit = 20) {
  return domSnapshotElements(
    page,
    ({ attributes }) => attributes.class?.split(/\s+/).includes("tab"),
    limit,
    200,
  );
}

async function domThreadHeaderCandidates(page, limit = 5) {
  return domSnapshotElements(
    page,
    ({ attributes }) =>
      attributes["data-chat-type"] === "thread" &&
      attributes.class?.split(/\s+/).includes("chat-header"),
    limit,
    500,
  );
}

async function domMessageCandidates(page, limit = 100) {
  return domSnapshotElements(
    page,
    ({ attributes }) => attributes.class?.split(/\s+/).includes("chat-message-row"),
    limit,
    12_000,
  );
}

function messageImageCandidates(row) {
  return (row.images || []).filter(({ rect }) =>
    rect.width > 0 &&
    rect.height > 0 &&
    Math.max(rect.width, rect.height) >= 96 &&
    rect.width * rect.height >= 4_096);
}

async function domScrollerCandidates(page, limit = 20) {
  return domSnapshotElements(
    page,
    ({ attributes, width, height }) => {
      const className = attributes.class || "";
      const classes = className.split(/\s+/);
      return width > 250 && height > 200 &&
        (classes.includes("infinite-scroll--chat") ||
          /history|message-list|chat-content/i.test(className));
    },
    limit,
    200,
  );
}

function parseMessageRow(row) {
  const parts = row.parts || {};
  const timestampLabel = row.labels.find((label) =>
    /^\d{2}\.\d{2}\.\d{4},\s+\d{1,2}:\d{2}:\d{2}/.test(label)) || null;
  const sender = parts["chat-message__title-text"]?.[0] || null;
  const displayedTimes = parts["chat-message__timestamp"]?.[0]?.match(/\d{1,2}:\d{2}(?::\d{2})?/g);
  const time = displayedTimes?.at(-1) ||
    timestampLabel?.match(/\d{1,2}:\d{2}:\d{2}/)?.[0] || null;
  const textParts = parts["chat-message__text"] || [];
  const contentParts = parts["chat-message__content"] || [];
  const text = normalizeText(textParts.join("\n")) ||
    normalizeText(contentParts[0]) ||
    normalizeText(row.text);
  const images = messageImageCandidates(row);
  if (!text && !images.length) return null;

  return {
    sender,
    time,
    timestamp: timestampLabel,
    direction: /chat-message-row--opponent/.test(row.className || "")
      ? "incoming"
      : textParts.length > 0
        ? "outgoing"
        : null,
    text,
    attachments: images.map((image, index) => ({
      type: "image",
      index,
      alt: image.alt,
      title: image.title,
      displayedWidth: image.rect.width,
      displayedHeight: image.rect.height,
    })),
  };
}

async function extractDomMessages(page, limit = 500) {
  const rows = await domMessageCandidates(page, limit);
  let previousSender = null;
  let currentDate = null;
  return rows.map((row) => {
    const message = parseMessageRow(row);
    if (!message) return null;
    const timestampDate = message.timestamp?.match(/^\d{2}\.\d{2}\.\d{4}/)?.[0];
    if (timestampDate) currentDate = timestampDate;
    else if (currentDate && message.time) message.timestamp = `${currentDate}, ${message.time}`;
    if (message.sender && message.direction === "incoming") previousSender = message.sender;
    else if (!message.sender && message.direction === "incoming") message.sender = previousSender;
    return message;
  }).filter(Boolean);
}

async function backendNodeMetrics(page, backendDOMNodeId) {
  const session = await page.context().newCDPSession(page);
  try {
    const { object } = await session.send("DOM.resolveNode", { backendNodeId: backendDOMNodeId });
    const { result } = await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        const style = getComputedStyle(this);
        return {
          scrollTop: this.scrollTop,
          scrollHeight: this.scrollHeight,
          clientHeight: this.clientHeight,
          overflowY: style.overflowY,
        };
      }`,
    });
    return result.value || null;
  } finally {
    await session.detach();
  }
}

async function scrollMessageHistory(page) {
  const candidates = await domScrollerCandidates(page);
  for (const candidate of candidates) {
    const before = await backendNodeMetrics(page, candidate.backendDOMNodeId);
    if (!before || before.scrollHeight <= before.clientHeight + 50) continue;

    const session = await page.context().newCDPSession(page);
    try {
      const x = candidate.rect.x + (candidate.rect.width / 2);
      const y = candidate.rect.y + (candidate.rect.height / 2);
      await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await session.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        deltaX: 0,
        deltaY: -Math.max(300, before.clientHeight * 0.85),
      });
    } finally {
      await session.detach();
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
    const after = await backendNodeMetrics(page, candidate.backendDOMNodeId).catch(() => null);
    return {
      before: before.scrollTop,
      after: after?.scrollTop ?? before.scrollTop,
      atTop: (after?.scrollTop ?? before.scrollTop) === 0,
    };
  }
  return null;
}

function messageSortValue(message) {
  const match = message.timestamp?.match(/^(\d{2})\.(\d{2})\.(\d{4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return Number.POSITIVE_INFINITY;
  return Date.UTC(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  );
}

async function waitForChatRows(page, limit, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let rows = [];
  do {
    rows = await domChatCandidates(page, limit);
    if (rows.length) return rows;
    await new Promise((resolve) => setTimeout(resolve, 750));
  } while (Date.now() < deadline);
  return rows;
}

const CHAT_TIME_PATTERN = /^(?:(?:[01]?\d|2[0-3]):[0-5]\d|today|yesterday|сегодня|вчера|\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)$/i;

function parseChatRow(row) {
  const lines = row.text.split("\n").map(normalizeText).filter(Boolean);
  const timeIndex = lines.findIndex((line) => CHAT_TIME_PATTERN.test(line));
  const labeledTitle = row.labels.find((label) =>
    !/^\d+$/.test(label) &&
    !/^\d{1,2}\.\d{1,2}\.\d{4},\s+\d{1,2}:\d{2}:\d{2}$/.test(label) &&
    !/,\s+[a-z_]+(?:,\s+[a-z_]+)*$/i.test(label));
  const textTitle = timeIndex > 0 ? lines.slice(0, timeIndex).join(" ") : null;
  const afterTime = timeIndex >= 0 ? lines[timeIndex + 1] : null;
  const titleAfterTime = afterTime?.length > 3 ? afterTime : lines[timeIndex + 2];
  const title = textTitle || labeledTitle || titleAfterTime || lines[0];
  if (!title) return null;

  const unreadSignals = row.classNames.filter((className) =>
    /chat-list-entry__time--unread|chat-list-entry-counter/i.test(className));
  const unread = unreadSignals.length > 0 ||
    row.labels.some((label) => /unread|непрочит/i.test(label));
  const unreadCount = unread
    ? [...lines].reverse().find((line) => /^\d+$/.test(line)) || null
    : null;
  const previewLines = lines.filter((line, index) => {
    if (index === timeIndex || line === title || line === ":") return false;
    if (labeledTitle && line === labeledTitle) return false;
    return true;
  });

  return {
    title,
    time: timeIndex >= 0 ? lines[timeIndex] : null,
    preview: previewLines.join(" | ") || null,
    unread,
    unreadCount,
    visibleText: row.text,
  };
}

function parseThreadRow(row) {
  const lines = row.text.split("\n").map(normalizeText).filter(Boolean);
  const timeIndex = lines.findIndex((line) => CHAT_TIME_PATTERN.test(line));
  const chatTitle = timeIndex > 0 ? lines.slice(0, timeIndex).join(" ") : lines[0];
  const topic = timeIndex >= 0 ? lines[timeIndex + 1] : lines[1];
  if (!chatTitle || !topic) return null;

  return {
    chatTitle,
    updatedAt: timeIndex >= 0 ? lines[timeIndex] : null,
    topic,
    preview: lines.slice(timeIndex >= 0 ? timeIndex + 2 : 2).join(" | ") || null,
    visibleText: row.text,
  };
}

export function clipText(value, maxChars) {
  const text = normalizeText(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} characters]`;
}

async function bodySnapshot(surface, maxChars = 30_000) {
  const body = surface.locator("body");
  const text = clipText(await body.innerText({ timeout: 15_000 }), maxChars);
  let aria = null;
  try {
    aria = clipText(await body.ariaSnapshot({ timeout: 10_000 }), maxChars);
  } catch {
    // Older browser builds may not expose an ARIA snapshot.
  }
  return { text, aria };
}

async function resolveAppSurface(page) {
  const frames = page.frames();
  let best = page.mainFrame();
  let bestScore = -1;

  for (const frame of frames) {
    const score = await frame.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const buttons = document.querySelectorAll("button").length;
      const listItems = document.querySelectorAll('[role="listitem"], [role="treeitem"]').length;
      return Math.min(bodyText.length, 50_000) + (buttons * 100) + (listItems * 200);
    }).catch(() => -1);
    if (score > bestScore) {
      best = frame;
      bestScore = score;
    }
  }

  return best;
}

export async function inspectUi(page, maxChars = 30_000) {
  const surface = await resolveAppSurface(page);
  const chatCandidates = await domChatCandidates(page, 10);
  const messageCandidates = await domMessageCandidates(page, 12);
  const scrollerCandidates = await domScrollerCandidates(page);
  const summarizeCandidate = (candidate) => {
    const parsed = parseMessageRow(candidate);
    return {
    backendDOMNodeId: candidate.backendDOMNodeId,
    className: candidate.className,
    parsed: parsed ? { ...parsed, text: clipText(parsed.text, 500) } : null,
    rect: candidate.rect,
    };
  };

  return {
    url: page.url(),
    title: await page.title(),
    surfaceUrl: surface.url(),
    frames: page.frames().map((frame) => ({ name: frame.name(), url: frame.url() })),
    domChatCandidates: chatCandidates.map((candidate) => ({
      title: parseChatRow(candidate)?.title || null,
      className: candidate.className,
      unreadSignals: candidate.classNames.filter((className) =>
        /chat-list-entry__time--unread|chat-list-entry-counter/i.test(className)),
      rect: candidate.rect,
    })),
    domMessageCandidates: messageCandidates.map(summarizeCandidate),
    domScrollerCandidates: await Promise.all(scrollerCandidates.map(async (candidate) => ({
      backendDOMNodeId: candidate.backendDOMNodeId,
      className: candidate.className,
      rect: candidate.rect,
      metrics: await backendNodeMetrics(page, candidate.backendDOMNodeId),
    }))),
    ...(await bodySnapshot(surface, maxChars)),
  };
}

export async function prepareCorporateLogin(page, corporateServerUrl) {
  if (!corporateServerUrl) return { prepared: false, reason: "corporate-server-not-configured" };

  const serverInput = page.locator('input[name="ctsHost"]');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await serverInput.isVisible().catch(() => false)) break;
    if (await page.getByRole("button", {
      name: /corporate server address|адрес корпоративного сервера/i,
    }).isVisible().catch(() => false)) break;
    await page.waitForTimeout(500);
  }
  if (!(await serverInput.isVisible().catch(() => false))) {
    const methodButton = page.getByRole("button", {
      name: /corporate server address|адрес корпоративного сервера/i,
    });
    if (!(await methodButton.isVisible().catch(() => false))) {
      return { prepared: false, reason: "login-screen-not-visible" };
    }
    await methodButton.click();
  }

  await serverInput.fill(new URL(corporateServerUrl).host);
  return {
    prepared: true,
    corporateServer: new URL(corporateServerUrl).origin,
    submitted: false,
  };
}

async function listChatsGeneric(surface, limit) {
  const result = await surface.locator(CHAT_SELECTORS.join(",")).evaluateAll(
    (elements, resultLimit) => {
      const clean = (value) => String(value || "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{2,}/g, "\n")
        .trim();
      const seen = new Set();
      const chats = [];
      const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);

      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 80 || rect.height < 20 || rect.height > 220) continue;
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
        if (rect.left > viewportWidth * 0.58) continue;

        const text = clean(element.innerText || element.textContent);
        if (!text || text.length > 600) continue;
        const lines = text.split("\n").map(clean).filter(Boolean);
        if (!lines.length || lines.length > 10) continue;

        const signature = lines.join("|").toLocaleLowerCase();
        if (seen.has(signature)) continue;
        seen.add(signature);

        const metadata = clean([
          element.getAttribute("aria-label"),
          element.getAttribute("data-testid"),
          element.getAttribute("data-qa"),
          element.className,
        ].join(" "));
        const unread = /unread|непрочит/i.test(metadata) || Boolean(
          element.querySelector('[class*="unread" i], [data-testid*="unread" i], [aria-label*="непрочит" i]'),
        );

        chats.push({
          title: lines[0],
          preview: lines.slice(1).join(" | ") || null,
          unread,
          visibleText: text,
        });
        if (chats.length >= resultLimit) break;
      }

      return chats;
    },
    limit,
  );

  if (result.length) return { chats: result, detection: "generic-dom" };
  return {
    chats: [],
    detection: "fallback",
    ...(await bodySnapshot(surface, 20_000)),
  };
}

export async function listChats(page, limit = 100) {
  const rows = await waitForChatRows(page, Math.max(limit, 100));
  const chats = rows.map(parseChatRow).filter(Boolean).slice(0, limit);
  if (chats.length) return { chats, detection: "express-dom-snapshot" };
  return listChatsGeneric(await resolveAppSurface(page), limit);
}

export async function listThreads(page, limit = 100) {
  const previousTab = await selectedChatListTab(page);
  await selectChatListTab(page, "Обсуждения");
  try {
    const rows = await waitForChatRows(page, Math.max(limit, 100));
    const threads = rows.map(parseThreadRow).filter(Boolean).slice(0, limit);
    return { threads, detection: "express-dom-snapshot" };
  } finally {
    if (previousTab && normalizeText(previousTab) !== "Обсуждения") {
      await selectChatListTab(page, previousTab).catch(() => {});
    }
  }
}

async function clickBackendNode(page, backendDOMNodeId) {
  const session = await page.context().newCDPSession(page);
  try {
    const { object } = await session.send("DOM.resolveNode", { backendNodeId: backendDOMNodeId });
    await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: 'function () { this.scrollIntoView({ block: "center", inline: "nearest" }); }',
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const { model } = await session.send("DOM.getBoxModel", { backendNodeId: backendDOMNodeId });
    const rect = quadToRect(model.border);
    if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error("The chat row has no clickable bounds.");
    const x = rect.x + (rect.width / 2);
    const y = rect.y + (rect.height / 2);
    await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  } finally {
    await session.detach();
  }
}

async function clickBackendNodeDescendant(page, backendDOMNodeId, selector) {
  const session = await page.context().newCDPSession(page);
  try {
    const { object } = await session.send("DOM.resolveNode", { backendNodeId: backendDOMNodeId });
    const { result } = await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      returnByValue: true,
      arguments: [{ value: selector }],
      functionDeclaration: `function (selector) {
        const target = this.querySelector(selector);
        if (!target) return false;
        target.click();
        return true;
      }`,
    });
    return result.value === true;
  } finally {
    await session.detach();
  }
}

async function selectedChatListTab(page) {
  const selected = (await domTabCandidates(page)).find((candidate) =>
    candidate.className?.split(/\s+/).includes("tab--selected"));
  return selected?.text || null;
}

async function waitForChatListTabs(page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let tabs = [];
  do {
    tabs = await domTabCandidates(page);
    if (tabs.length) return tabs;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return tabs;
}

async function selectChatListTab(page, title, timeoutMs = 10_000) {
  const normalizedTitle = normalizeText(title).toLocaleLowerCase();
  const tabs = await waitForChatListTabs(page);
  const tab = tabs.find((candidate) =>
    normalizeText(candidate.text).toLocaleLowerCase() === normalizedTitle);
  if (!tab) throw new Error(`The eXpress tab "${title}" was not found.`);
  if (tab.className?.split(/\s+/).includes("tab--selected")) return;

  await clickBackendNode(page, tab.backendDOMNodeId);
  const deadline = Date.now() + timeoutMs;
  do {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const selected = await selectedChatListTab(page);
    if (normalizeText(selected).toLocaleLowerCase() === normalizedTitle) return;
  } while (Date.now() < deadline);
  throw new Error(`The eXpress tab "${title}" did not become active.`);
}

async function waitForThreadHeader(page, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const header = (await domThreadHeaderCandidates(page, 1))[0];
    if (header) return header;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error("The eXpress thread did not open.");
}

async function clickChatByTitle(page, surface, title) {
  const row = (await waitForChatRows(page, 300))
    .find((candidate) => parseChatRow(candidate)?.title.toLocaleLowerCase() === title.toLocaleLowerCase());
  if (row) {
    await clickBackendNode(page, row.backendDOMNodeId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    return;
  }

  const exactMatches = surface.getByText(title, { exact: true });
  const count = Math.min(await exactMatches.count(), 30);
  const viewportWidth = await surface.evaluate(() => window.innerWidth);

  for (let index = 0; index < count; index += 1) {
    const match = exactMatches.nth(index);
    if (!(await match.isVisible())) continue;
    const box = await match.boundingBox();
    if (!box || box.x > viewportWidth * 0.62) continue;
    await match.click({ timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 500));
    return;
  }

  throw new Error(`A visible chat named "${title}" was not found. Use express_list_chats or express_inspect_ui first.`);
}

async function tagMessageScroller(surface) {
  return surface.locator("body *").evaluateAll((elements) => {
    document.querySelectorAll("[data-codex-express-scroller]").forEach((element) => {
      element.removeAttribute("data-codex-express-scroller");
    });

    const viewportWidth = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
    const candidates = elements
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return rect.left < viewportWidth &&
          rect.right > viewportWidth * 0.35 &&
          rect.width > viewportWidth * 0.25 &&
          rect.height > window.innerHeight * 0.25 &&
          element.scrollHeight > element.clientHeight + 80 &&
          /(auto|scroll)/.test(style.overflowY);
      })
      .sort((a, b) => {
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        return (bRect.width * bRect.height) - (aRect.width * aRect.height);
      });

    const scroller = candidates[0];
    if (!scroller) return false;
    scroller.setAttribute("data-codex-express-scroller", "true");
    return true;
  });
}

async function extractVisibleMessages(surface) {
  return surface.locator(MESSAGE_SELECTORS.join(",")).evaluateAll((nodes) => {
    const clean = (value) => String(value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const leafNodes = nodes.filter(
      (node) => !nodes.some((other) => other !== node && node.contains(other)),
    );
    const output = [];
    const seen = new Set();

    for (const element of leafNodes) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 80 || rect.height < 16 || rect.height > window.innerHeight * 1.5) continue;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) continue;
      const text = clean(element.innerText || element.textContent);
      if (!text || text.length > 12_000 || seen.has(text)) continue;
      seen.add(text);

      const senderElement = element.querySelector(
        '[data-testid*="sender" i], [data-testid*="author" i], [class*="sender" i], [class*="author" i]',
      );
      const timeElement = element.querySelector(
        'time, [datetime], [class*="time" i], [data-testid*="time" i]',
      );
      output.push({
        sender: clean(senderElement?.innerText || senderElement?.textContent) || null,
        time: clean(timeElement?.getAttribute("datetime") || timeElement?.innerText || timeElement?.textContent) || null,
        text,
      });
    }
    return output;
  });
}

async function scrollUp(surface) {
  return surface.locator('[data-codex-express-scroller="true"]').evaluate((element) => {
    const before = element.scrollTop;
    element.scrollTop = Math.max(0, before - Math.max(300, element.clientHeight * 0.85));
    return { before, after: element.scrollTop, atTop: element.scrollTop === 0 };
  });
}

async function collectDomMessageHistory(page, historyPages, messageLimit) {
  const collected = new Map();
  for (let pageIndex = 0; pageIndex < historyPages; pageIndex += 1) {
    for (const message of await extractDomMessages(page, Math.max(messageLimit, 500))) {
      const key = `${message.timestamp || ""}\n${message.direction || ""}\n${message.sender || ""}\n${message.text}`;
      collected.set(key, message);
    }
    if (pageIndex + 1 >= historyPages) break;
    const movement = await scrollMessageHistory(page);
    if (!movement || movement.before === movement.after || movement.atTop) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return [...collected.values()].sort((left, right) =>
    messageSortValue(left) - messageSortValue(right));
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 12_000_000;

async function captureImageFromBackendNode(page, backendDOMNodeId) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: backendDOMNodeId }).catch(async () => {
      const { object } = await session.send("DOM.resolveNode", { backendNodeId: backendDOMNodeId });
      await session.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: `function () {
          this.scrollIntoView({ block: "center", inline: "nearest" });
        }`,
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 400));

    const { object } = await session.send("DOM.resolveNode", { backendNodeId: backendDOMNodeId });
    for (const maxDimension of [4_096, 2_048, 1_024]) {
      const { result, exceptionDetails } = await session.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        returnByValue: true,
        arguments: [{ value: maxDimension }, { value: MAX_IMAGE_PIXELS }],
        functionDeclaration: `function (maxDimension, maxPixels) {
          if (!(this instanceof HTMLImageElement) || !this.complete || !this.naturalWidth || !this.naturalHeight) {
            return { error: "image-not-ready" };
          }
          const naturalWidth = this.naturalWidth;
          const naturalHeight = this.naturalHeight;
          const scale = Math.min(
            1,
            maxDimension / naturalWidth,
            maxDimension / naturalHeight,
            Math.sqrt(maxPixels / (naturalWidth * naturalHeight)),
          );
          const width = Math.max(1, Math.round(naturalWidth * scale));
          const height = Math.max(1, Math.round(naturalHeight * scale));
          try {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            context.drawImage(this, 0, 0, width, height);
            return {
              data: canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, ""),
              width,
              height,
              naturalWidth,
              naturalHeight,
              method: "canvas",
            };
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
          }
        }`,
      });
      const capture = exceptionDetails ? null : result.value;
      if (!capture?.data) continue;
      const sizeBytes = Buffer.from(capture.data, "base64").byteLength;
      if (sizeBytes <= MAX_IMAGE_BYTES) {
        return { ...capture, sizeBytes, mimeType: "image/png" };
      }
    }

    const { result: boundsResult } = await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        const rect = this.getBoundingClientRect();
        return {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          viewportX: rect.x,
          viewportY: rect.y,
          width: rect.width,
          height: rect.height,
          naturalWidth: this instanceof HTMLImageElement ? this.naturalWidth : null,
          naturalHeight: this instanceof HTMLImageElement ? this.naturalHeight : null,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        };
      }`,
    });
    const bounds = boundsResult.value;
    const rect = bounds && {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    };
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      throw new Error("The selected eXpress image has no visible bounds.");
    }

    const naturalWidth = Number(bounds.naturalWidth) || 0;
    const naturalHeight = Number(bounds.naturalHeight) || 0;
    const renderedScale = naturalWidth && naturalHeight
      ? Math.min(
        1,
        4_096 / naturalWidth,
        4_096 / naturalHeight,
        Math.sqrt(MAX_IMAGE_PIXELS / (naturalWidth * naturalHeight)),
        bounds.viewportWidth / naturalWidth,
        bounds.viewportHeight / naturalHeight,
      )
      : 0;
    const renderedWidth = Math.max(1, Math.round(naturalWidth * renderedScale));
    const renderedHeight = Math.max(1, Math.round(naturalHeight * renderedScale));
    if (renderedScale > 0 &&
        (renderedWidth > rect.width + 1 || renderedHeight > rect.height + 1)) {
      const cloneId = `codex-express-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        const { result: cloneResult, exceptionDetails } = await session.send("Runtime.callFunctionOn", {
          objectId: object.objectId,
          returnByValue: true,
          awaitPromise: true,
          arguments: [
            { value: cloneId },
            { value: renderedWidth },
            { value: renderedHeight },
          ],
          functionDeclaration: `async function (id, width, height) {
            const clone = this.cloneNode(true);
            clone.id = id;
            clone.removeAttribute("class");
            clone.removeAttribute("style");
            clone.style.setProperty("position", "fixed", "important");
            clone.style.setProperty("left", "0", "important");
            clone.style.setProperty("top", "0", "important");
            clone.style.setProperty("width", width + "px", "important");
            clone.style.setProperty("height", height + "px", "important");
            clone.style.setProperty("max-width", "none", "important");
            clone.style.setProperty("max-height", "none", "important");
            clone.style.setProperty("object-fit", "fill", "important");
            clone.style.setProperty("display", "block", "important");
            clone.style.setProperty("margin", "0", "important");
            clone.style.setProperty("padding", "0", "important");
            clone.style.setProperty("border", "0", "important");
            clone.style.setProperty("border-radius", "0", "important");
            clone.style.setProperty("opacity", "1", "important");
            clone.style.setProperty("filter", "none", "important");
            clone.style.setProperty("transform", "none", "important");
            clone.style.setProperty("clip-path", "none", "important");
            clone.style.setProperty("pointer-events", "none", "important");
            clone.style.setProperty("z-index", "2147483647", "important");
            document.documentElement.appendChild(clone);
            if (typeof clone.decode === "function") {
              await Promise.race([
                clone.decode().catch(() => {}),
                new Promise((resolve) => setTimeout(resolve, 1_500)),
              ]);
            }
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            return { x: window.scrollX, y: window.scrollY };
          }`,
        });
        if (!exceptionDetails && cloneResult.value) {
          const rendered = await session.send("Page.captureScreenshot", {
            format: "png",
            fromSurface: true,
            captureBeyondViewport: false,
            clip: {
              x: cloneResult.value.x,
              y: cloneResult.value.y,
              width: renderedWidth,
              height: renderedHeight,
              scale: 1,
            },
          });
          const renderedSizeBytes = Buffer.from(rendered.data, "base64").byteLength;
          if (renderedSizeBytes <= MAX_IMAGE_BYTES) {
            return {
              data: rendered.data,
              width: renderedWidth,
              height: renderedHeight,
              naturalWidth,
              naturalHeight,
              method: "rendered-full-size",
              sizeBytes: renderedSizeBytes,
              mimeType: "image/png",
            };
          }
        }
      } catch {
        // Fall back to the visible inline rendering below.
      } finally {
        await session.send("Runtime.evaluate", {
          expression: `document.getElementById(${JSON.stringify(cloneId)})?.remove()`,
        }).catch(() => {});
      }
    }

    if (bounds.viewportX < 0 || bounds.viewportY < 0 ||
        bounds.viewportX + bounds.width > bounds.viewportWidth ||
        bounds.viewportY + bounds.height > bounds.viewportHeight) {
      throw new Error("The selected eXpress image could not be scrolled fully into view.");
    }
    const screenshot = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
      clip: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        scale: 1,
      },
    });
    const sizeBytes = Buffer.from(screenshot.data, "base64").byteLength;
    if (sizeBytes > MAX_IMAGE_BYTES) {
      throw new Error(`The selected eXpress image is too large (${sizeBytes} bytes).`);
    }
    return {
      data: screenshot.data,
      width: rect.width,
      height: rect.height,
      naturalWidth: bounds.naturalWidth || null,
      naturalHeight: bounds.naturalHeight || null,
      method: "rendered-screenshot",
      sizeBytes,
      mimeType: "image/png",
    };
  } finally {
    await session.detach();
  }
}

function messageMatchesImageQuery(message, messageQuery, sender) {
  const normalizedText = normalizeText(message.text).toLocaleLowerCase();
  const normalizedQuery = normalizeText(messageQuery).toLocaleLowerCase();
  if (!normalizedText.includes(normalizedQuery)) return false;
  if (!sender) return true;
  return normalizeText(message.sender).toLocaleLowerCase() === normalizeText(sender).toLocaleLowerCase();
}

async function findAndCaptureMessageImage(
  page,
  { messageQuery, sender = null, imageIndex = 0, historyPages = 4 },
  assertAllowed = null,
) {
  let matchingMessages = 0;
  let largestImageCount = 0;

  for (let pageIndex = 0; pageIndex < historyPages; pageIndex += 1) {
    const rows = await domMessageCandidates(page, 500);
    const matches = rows
      .map((row) => ({ row, message: parseMessageRow(row) }))
      .filter(({ message }) => message && messageMatchesImageQuery(message, messageQuery, sender))
      .reverse();

    for (const { row, message } of matches) {
      matchingMessages += 1;
      const images = messageImageCandidates(row);
      largestImageCount = Math.max(largestImageCount, images.length);
      const selected = images[imageIndex];
      if (!selected) continue;

      await assertAllowed?.();
      const capture = await captureImageFromBackendNode(page, selected.backendDOMNodeId);
      await assertAllowed?.();
      return {
        data: capture.data,
        mimeType: capture.mimeType,
        message: {
          sender: message.sender,
          time: message.time,
          timestamp: message.timestamp,
          direction: message.direction,
          text: clipText(message.text, 500),
        },
        image: {
          index: imageIndex,
          countInMessage: images.length,
          width: capture.width,
          height: capture.height,
          naturalWidth: capture.naturalWidth,
          naturalHeight: capture.naturalHeight,
          sizeBytes: capture.sizeBytes,
          captureMethod: capture.method,
        },
      };
    }

    if (pageIndex + 1 >= historyPages) break;
    const movement = await scrollMessageHistory(page);
    if (!movement || movement.before === movement.after || movement.atTop) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (matchingMessages) {
    throw new Error(
      `Found ${matchingMessages} matching eXpress message(s), but image index ${imageIndex} was not available. ` +
      `The largest matching message contained ${largestImageCount} readable inline image(s).`,
    );
  }
  throw new Error(`No eXpress message matching "${messageQuery}" was found in the loaded history.`);
}

export async function readImageAttachment(
  page,
  {
    chatTitle,
    threadQuery = null,
    messageQuery,
    sender = null,
    imageIndex = 0,
    historyPages = 4,
  },
  assertAllowed = null,
) {
  await closeThread(page, null);
  const previousTab = await selectedChatListTab(page);

  try {
    if (threadQuery) {
      await readThread(page, {
        query: threadQuery,
        chatTitle,
        historyPages: 1,
        messageLimit: 1,
        closeAfter: false,
      }, assertAllowed);
    } else {
      await selectChatListTab(page, "Все чаты");
      const surface = await resolveAppSurface(page);
      await clickChatByTitle(page, surface, chatTitle);
      await assertAllowed?.();
      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    const captured = await findAndCaptureMessageImage(
      page,
      { messageQuery, sender, imageIndex, historyPages },
      assertAllowed,
    );
    return {
      chat: chatTitle,
      thread: threadQuery,
      ...captured,
      note: "Opening a chat or thread can mark messages as read in eXpress. Only rendered image pixels are returned.",
    };
  } finally {
    if (threadQuery) await closeThread(page, previousTab || "Все чаты");
  }
}

export async function closeThread(page, restoreTab = "Все чаты") {
  const header = (await domThreadHeaderCandidates(page, 1))[0];
  if (!header) {
    if (restoreTab) await selectChatListTab(page, restoreTab).catch(() => {});
    return { closed: false, reason: "no-thread-open", restoredTab: restoreTab || null };
  }

  const clicked = await clickBackendNodeDescendant(page, header.backendDOMNodeId, "button");
  if (!clicked) throw new Error("The open eXpress thread has no close control.");

  const deadline = Date.now() + 10_000;
  do {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if ((await domThreadHeaderCandidates(page, 1)).length === 0) break;
  } while (Date.now() < deadline);
  if ((await domThreadHeaderCandidates(page, 1)).length) {
    throw new Error("The eXpress thread close control did not close the thread.");
  }

  if (restoreTab) await selectChatListTab(page, restoreTab).catch(() => {});
  return { closed: true, restoredTab: restoreTab || null };
}

export async function readThread(
  page,
  {
    query,
    chatTitle = null,
    historyPages = 4,
    messageLimit = 200,
    closeAfter = true,
  },
  assertAllowed = null,
) {
  await closeThread(page, null);
  const previousTab = await selectedChatListTab(page);
  await selectChatListTab(page, "Обсуждения");

  try {
    const rows = await waitForChatRows(page, 300);
    const candidates = rows.map((row) => ({ row, thread: parseThreadRow(row) })).filter(({ thread }) => thread);
    const normalizedQuery = normalizeText(query).toLocaleLowerCase();
    const normalizedChatTitle = normalizeText(chatTitle).toLocaleLowerCase();
    const matches = candidates.filter(({ thread }) => {
      if (normalizedChatTitle && thread.chatTitle.toLocaleLowerCase() !== normalizedChatTitle) return false;
      return thread.topic.toLocaleLowerCase() === normalizedQuery ||
        thread.visibleText.toLocaleLowerCase().includes(normalizedQuery);
    });
    const selected = matches.find(({ thread }) => thread.topic.toLocaleLowerCase() === normalizedQuery) || matches[0];
    if (!selected) {
      throw new Error(`A visible eXpress thread matching "${query}" was not found. Use express_list_threads first.`);
    }

    await clickBackendNode(page, selected.row.backendDOMNodeId);
    await waitForThreadHeader(page);
    await assertAllowed?.();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const allMessages = await collectDomMessageHistory(page, historyPages, messageLimit);
    const parentIndex = allMessages.findIndex((message) =>
      normalizeText(message.text).toLocaleLowerCase() === selected.thread.topic.toLocaleLowerCase());
    const fallbackParentIndex = allMessages.length ? 0 : -1;
    const actualParentIndex = parentIndex >= 0 ? parentIndex : fallbackParentIndex;
    const parent = actualParentIndex >= 0 ? allMessages[actualParentIndex] : null;
    const messages = allMessages.filter((_, index) => index !== actualParentIndex);

    return {
      thread: selected.thread,
      parent,
      messages: messages.slice(-messageLimit),
      messageCount: Math.min(messages.length, messageLimit),
      loadedMessageCount: messages.length,
      detection: "express-dom-snapshot",
      closedAfterRead: closeAfter,
      note: "Opening a thread can mark its messages as read in eXpress.",
    };
  } finally {
    if (closeAfter) {
      await closeThread(page, previousTab || "Все чаты");
    }
  }
}

export async function readChat(
  page,
  title,
  historyPages = 4,
  messageLimit = 200,
  assertAllowed = null,
) {
  await closeThread(page, null);
  await selectChatListTab(page, "Все чаты");
  const surface = await resolveAppSurface(page);
  await clickChatByTitle(page, surface, title);
  await assertAllowed?.();
  await new Promise((resolve) => setTimeout(resolve, 750));

  const domMessages = await collectDomMessageHistory(page, historyPages, messageLimit);
  if (domMessages.length) {
    return {
      chat: title,
      messages: domMessages.slice(-messageLimit),
      messageCount: Math.min(domMessages.length, messageLimit),
      loadedMessageCount: domMessages.length,
      detection: "express-dom-snapshot",
      note: "Opening a chat can mark messages as read in eXpress.",
    };
  }

  const hasScroller = await tagMessageScroller(surface);
  const collected = new Map();

  for (let pageIndex = 0; pageIndex < historyPages; pageIndex += 1) {
    for (const message of await extractVisibleMessages(surface)) {
      const key = `${message.sender || ""}\n${message.time || ""}\n${message.text}`;
      collected.set(key, message);
    }

    if (!hasScroller) break;
    const movement = await scrollUp(surface);
    if (movement.before === movement.after || movement.atTop) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  const messages = [...collected.values()].slice(-messageLimit);
  return {
    chat: title,
    messages,
    messageCount: messages.length,
    detection: messages.length ? "structured" : "fallback",
    fallback: messages.length ? null : await bodySnapshot(surface, 30_000),
    note: "Opening a chat can mark messages as read in eXpress.",
  };
}
