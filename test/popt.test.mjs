import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/args.mjs";
import { readMagpieKey } from "../src/config.mjs";
import { complete, createSseParser, messageText } from "../src/llm.mjs";
import { fence } from "../src/templates.mjs";

test("fence keeps a closing tag inside the payload", () => {
  const wrapped = fence("original_prompt", "keep </original_prompt> inside");
  assert.equal(wrapped.startsWith("<original_prompt>\n"), true);
  assert.equal(wrapped.endsWith("\n</original_prompt>"), true);
  assert.equal(wrapped.includes("</original_prompt> inside"), false);
  assert.equal(wrapped.includes("< /original_prompt>"), true);
});

test("parseArgs routes iterate and rejects a bad mode", () => {
  const args = parseArgs(["-m", "image", "-f", "idea.txt", "--no-stream", "--model", "grok/grok-4.7"]);
  assert.equal(args.mode, "image");
  assert.equal(args.file, "idea.txt");
  assert.equal(args.stream, false);
  assert.equal(args.model, "grok/grok-4.7");
  const iterated = parseArgs(["-i", "只要五步", "draft prompt"]);
  assert.equal(iterated.mode, "auto");
  assert.equal(iterated.iterate, "只要五步");
  assert.equal(iterated.prompt, "draft prompt");
  assert.throws(() => parseArgs(["-m", "video"]), /unknown mode/);
  assert.equal(parseArgs([]).mode, "auto");
  const flags = parseArgs(["-q", "--lang", "en", "--brief", "x"]);
  assert.equal(flags.quiet, true);
  assert.equal(flags.lang, "en");
  assert.equal(flags.showBrief, true);
});

test("readMagpieKey only returns the magpie provider key", () => {
  const text = `providers:\n  other:\n    apiKey: other-key\n  magpie:\n    api: openai-completions\n    apiKey: local-key\n    baseUrl: http://127.0.0.1:3425/v1\n  later:\n    apiKey: later-key\n`;
  assert.equal(readMagpieKey(text), "local-key");
  assert.equal(readMagpieKey("providers:\n  magpie:\n    apiKey: \"quoted\"\n"), "quoted");
  assert.equal(readMagpieKey("nope: true\n"), "");
});

test("messageText ignores reasoning and joins array parts", () => {
  assert.equal(messageText({ choices: [{ message: { content: "only this", reasoning: "hidden" } }] }), "only this");
  assert.equal(
    messageText({ choices: [{ delta: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] }),
    "ab",
  );
});

test("sse parser accepts chunks split mid-line", () => {
  const events = [];
  const parser = createSseParser((data) => events.push(data));
  parser.push('data: {"choices":[{"delta":{"content":"he');
  parser.push('llo"}}]}\n\ndata: [DONE]\n');
  assert.deepEqual(events, ['{"choices":[{"delta":{"content":"hello"}}]}', "[DONE]"]);
});

test("complete posts chat completions and returns content", async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return new Response(JSON.stringify({ choices: [{ message: { content: "rewritten" } }] }), { status: 200 });
  };
  const text = await complete({
    baseUrl: "http://127.0.0.1:3425/v1",
    apiKey: "secret-key",
    model: "grok/grok-4.7",
    messages: [{ role: "user", content: "x" }],
    stream: false,
    fetchImpl,
  });
  assert.equal(text, "rewritten");
  assert.equal(seen.url, "http://127.0.0.1:3425/v1/chat/completions");
  assert.equal(seen.init.headers.Authorization, "Bearer secret-key");
  assert.equal(JSON.parse(seen.init.body).model, "grok/grok-4.7");
});

test("complete redacts the key from an error body", async () => {
  const fetchImpl = async () => new Response("bad secret-key", { status: 401 });
  await assert.rejects(
    () => complete({
      baseUrl: "http://127.0.0.1:3425/v1",
      apiKey: "secret-key",
      model: "grok/grok-4.7",
      messages: [],
      fetchImpl,
    }),
    /<redacted>/,
  );
});

test("complete streams content deltas and flushes a trailing event", async () => {
  const payload = 'data: {"choices":[{"delta":{"content":"re"}}]}\n\ndata: {"choices":[{"delta":{"content":"written"}}]}';
  const fetchImpl = async () => new Response(payload, { status: 200 });
  const deltas = [];
  const text = await complete({
    baseUrl: "http://127.0.0.1:3425/v1/",
    apiKey: "secret-key",
    model: "grok/grok-4.7",
    messages: [{ role: "user", content: "x" }],
    stream: true,
    onDelta: (piece) => deltas.push(piece),
    fetchImpl,
  });
  assert.equal(text, "rewritten");
  assert.deepEqual(deltas, ["re", "written"]);
});

