import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_WEB_URL, normalizeWebUrl } from "../src/config.mjs";

test("uses the official eXpress Web client by default", () => {
  assert.equal(DEFAULT_WEB_URL, "https://corp.express");
});

test("normalizes an allowed eXpress URL", () => {
  assert.equal(normalizeWebUrl("https://express.example.test/"), "https://express.example.test");
});

test("rejects non-web URL schemes", () => {
  assert.throws(() => normalizeWebUrl("file:///C:/secret"), /http or https/);
});
