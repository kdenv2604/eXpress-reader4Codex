import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_CONTRACT } from "../src/tool-contract.mjs";

const FORBIDDEN_WRITE_WORDS = /send|reply|react|edit|delete|upload|forward/i;

test("the MCP contract exposes no messenger mutations", () => {
  assert.ok(TOOL_CONTRACT.length > 0);
  assert.deepEqual(TOOL_CONTRACT.filter((tool) => tool.messengerMutation), []);
  assert.deepEqual(
    TOOL_CONTRACT.map((tool) => tool.name).filter((name) => FORBIDDEN_WRITE_WORDS.test(name)),
    [],
  );
});
