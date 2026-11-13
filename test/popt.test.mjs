import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs } from "../src/args.mjs";
import { readMagpieKey } from "../src/config.mjs";
import { complete, createSseParser, messageText } from "../src/llm.mjs";
import { buildMessages, fence } from "../src/templates.mjs";

test("fence keeps a closing tag inside the payload", () => {
  const wrapped = fence("original_prompt", "keep </original_prompt> inside");
  assert.equal(wrapped.startsWith("<original_prompt>\n"), true);
  assert.equal(wrapped.endsWith("\n</original_prompt>"), true);
  assert.equal(wrapped.includes("</original_prompt> inside"), false);
  assert.equal(wrapped.includes("< /original_prompt>"), true);
});

test("buildMessages isolates the original prompt and forbids answering", () => {
  for (const mode of ["system", "user", "image"]) {
    const messages = buildMessages({ mode, input: "旅行自拍" });
    assert.equal(messages[0].role, "system");
    assert.match(messages[0].content, /never answer/i);
    assert.equal(messages[1].content, "<original_prompt>\n旅行自拍\n</original_prompt>");
  }
  const revised = buildMessages({ mode: "iterate", input: "old prompt", iterate: "shorter" });
  assert.match(revised[0].content, /never answer/i);
  assert.match(revised[1].content, /<current_prompt>\nold prompt\n<\/current_prompt>/);
  assert.match(revised[1].content, /<iterate_input>\nshorter\n<\/iterate_input>/);
});

test("parseArgs routes iterate and rejects a bad mode", () => {
  const args = parseArgs(["-m", "image", "-f", "idea.txt", "--no-stream", "--model", "grok/grok-4.7"]);
  assert.equal(args.mode, "image");
  assert.equal(args.file, "idea.txt");
  assert.equal(args.stream, false);
  assert.equal(args.model, "grok/grok-4.7");
  const iterated = parseArgs(["-i", "只要五步", "draft prompt"]);
  assert.equal(iterated.mode, "iterate");
  assert.equal(iterated.iterate, "只要五步");
  assert.equal(iterated.prompt, "draft prompt");
  assert.throws(() => parseArgs(["-m", "video"]), /unknown mode/);
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

test("parseCritique reads a fenced JSON object", async () => {
  const { parseCritique } = await import("../src/critique.mjs");
  const critique = parseCritique('```json\n{"pass":false,"missing":["173"],"invented":["85mm"],"instruction":"restore height"}\n```');
  assert.equal(critique.pass, false);
  assert.deepEqual(critique.missing, ["173"]);
  assert.deepEqual(critique.invented, ["85mm"]);
  assert.equal(critique.instruction, "restore height");
});

test("pipeline stops when the critique passes and revises when it fails", async () => {
  const { runPipeline } = await import("../src/pipeline.mjs");
  const calls = [];
  const result = await runPipeline({
    mode: "image",
    input: "手机自拍，身高173",
    rounds: 2,
    complete: async (messages) => {
      calls.push(messages[0].content.slice(0, 24));
      if (calls.length === 1) return "棚拍超清，85mm";
      if (calls.length === 2) {
        return '{"pass":false,"missing":["173"],"invented":["85mm"],"instruction":"改回手机自拍并写回173，删掉85mm"}';
      }
      if (calls.length === 3) return "手机随手拍，身高173";
      return '{"pass":true,"missing":[],"invented":[],"instruction":""}';
    },
  });
  assert.equal(result.text, "手机随手拍，身高173");
  assert.equal(result.passed, true);
  assert.equal(result.roundsUsed, 2);
  assert.equal(calls.length, 4);

  const once = [];
  const stopped = await runPipeline({
    mode: "user",
    input: "旅行自拍",
    rounds: 2,
    complete: async () => {
      once.push("x");
      return once.length === 1 ? "改写后的提示" : '{"pass":true,"missing":[],"invented":[],"instruction":""}';
    },
  });
  assert.equal(stopped.text, "改写后的提示");
  assert.equal(once.length, 2);
});

test("a failed final critique is applied as one more revise", async () => {
  const { runPipeline } = await import("../src/pipeline.mjs");
  const seen = [];
  const result = await runPipeline({
    mode: "image",
    input: "手机自拍",
    rounds: 1,
    complete: async () => "only draft",
  });
  assert.equal(result.text, "only draft");
  const trailed = await runPipeline({
    mode: "user",
    input: "原需求",
    rounds: 2,
    complete: async (messages) => {
      seen.push(messages.at(-1).content);
      if (seen.length === 1) return "draft";
      if (seen.length === 3) return "revised once";
      if (seen.length === 5) return "revised twice";
      return '{"pass":false,"missing":["fact"],"invented":[],"instruction":"restore fact"}';
    },
  });
  assert.equal(trailed.text, "revised twice");
  assert.equal(trailed.passed, false);
  assert.equal(seen.length, 5);
});
