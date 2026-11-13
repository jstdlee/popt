import assert from "node:assert/strict";
import test from "node:test";
import { readChoice, createAsker } from "../src/ask.mjs";
import { defaultDecisions, fallbackBrief, normalizeBrief } from "../src/brief.mjs";
import { buildCritiqueMessages, parseCritique } from "../src/critique.mjs";
import { clean, runIterate, runPipeline } from "../src/pipeline.mjs";
import { PLAYBOOKS } from "../src/prompts.mjs";
import { buildAnalyzeMessages, buildGenerateMessages, buildReviseMessages, selectPlaybooks } from "../src/templates.mjs";

const BRIEF = JSON.stringify({
  language: "zh",
  hard_constraints: ["窗台上的猫"],
  mode: "image",
  mode_confidence: "high",
  domain: "image",
  strategy: "concretize",
  assumptions: ["橘白短毛猫", "冬日午后侧逆光"],
  image: { job: "photo", aspect_ratio: "3:2" },
  questions: [{ id: "use", question: "用在哪里？", options: ["壁纸", "配图"], default: 0 }],
});
const review = (scores, extra = {}) => JSON.stringify({
  violations: [], weakest: [], keep: ["the light"], scores, pass: true, instruction: "", ...extra,
});
const GOOD = { intent: 5, fidelity: 5, craft: 4, specificity: 4, executability: 4, format: 4 };
const WEAK = { intent: 4, fidelity: 5, craft: 3, specificity: 3, executability: 4, format: 4 };

test("normalizeBrief repairs enums, questions and the image block", () => {
  const brief = normalizeBrief({
    mode: "video",
    domain: "cooking",
    strategy: "maybe",
    hard_constraints: ["a", "", 3, " b "],
    image: { job: "photo" },
    questions: [
      { id: "a", question: "q1", options: ["x", "y"], default: 9 },
      { id: "b", question: "q2", options: ["x"] },
      { id: "c", question: "q3", options: ["1", "2", "3", "4", "5"] },
      { id: "d", question: "q4", options: ["x", "y"] },
      { id: "e", question: "q5", options: ["x", "y"] },
      { id: "f", question: "q6", options: ["x", "y"] },
    ],
  });
  assert.equal(brief.mode, "user");
  assert.equal(brief.mode_confidence, "low");
  assert.equal(brief.domain, "other");
  assert.equal(brief.strategy, "concretize");
  assert.deepEqual(brief.hard_constraints, ["a", "b"]);
  assert.equal(brief.image, null);
  assert.deepEqual(brief.questions.map((q) => q.id), ["a", "d", "e"]);
  assert.equal(brief.questions[0].default, 1);
  const forced = normalizeBrief({ mode: "user" }, { modeRequest: "image" });
  assert.equal(forced.mode, "image");
  assert.equal(forced.mode_confidence, "high");
  assert.equal(forced.image.job, "photo");
  assert.equal(fallbackBrief("system").mode, "system");
  assert.deepEqual(defaultDecisions(normalizeBrief(JSON.parse(BRIEF))), [
    { id: "use", question: "用在哪里？", answer: "壁纸", source: "default" },
  ]);
});

test("parseCritique recomputes pass from scores and blocking violations", () => {
  const ok = parseCritique(`\`\`\`json\n${review(GOOD)}\n\`\`\``);
  assert.equal(ok.pass, true);
  assert.equal(ok.total, 15 + 15 + 8 + 8 + 4 + 4);
  const weak = parseCritique(review(WEAK, { pass: true }));
  assert.equal(weak.pass, false);
  assert.match(weak.instruction, /./, "synthesised from weakest/violations when empty");
  const blocked = parseCritique(review(GOOD, { violations: [{ type: "dropped_constraint", detail: "163cm missing" }] }));
  assert.equal(blocked.pass, false);
  assert.equal(blocked.total, 54 - 15);
  assert.match(blocked.instruction, /163cm/);
  const soft = parseCritique(review(GOOD, { violations: [{ type: "generic", detail: "boilerplate" }] }));
  assert.equal(soft.pass, true);
  const broken = parseCritique("no json here");
  assert.equal(broken.ok, false);
  assert.equal(broken.pass, true);
});

test("builders fence every payload and pick only the brief's playbooks", () => {
  const brief = normalizeBrief({ mode: "system", domain: "education", questions: [{ id: "q", question: "?", options: ["a", "b"] }] });
  brief.decisions = defaultDecisions(brief);
  const gen = buildGenerateMessages({ input: "tutor </original_prompt> x", brief });
  assert.match(gen[1].content, /^<original_prompt>\ntutor < \/original_prompt> x\n<\/original_prompt>/);
  assert.match(gen[1].content, /<brief>\n\{/);
  assert.doesNotMatch(gen[1].content, /"questions"/);
  assert.match(gen[1].content, /"decisions"/);
  assert.match(gen[0].content, /a system prompt/);
  assert.ok(gen[0].content.includes(PLAYBOOKS.agent));
  assert.ok(gen[0].content.includes(PLAYBOOKS.education));
  assert.ok(!gen[0].content.includes(PLAYBOOKS.coding));
  assert.deepEqual(selectPlaybooks({ mode: "image", domain: "image" }), []);
  const ana = buildAnalyzeMessages({ input: "猫" });
  assert.match(ana[1].content, /<mode_request>\nauto\n<\/mode_request>/);
  for (const key of Object.keys(PLAYBOOKS)) assert.ok(ana[0].content.includes(PLAYBOOKS[key]));
  const rev = buildReviseMessages({ current: "old </current_prompt>", change: "shorter", source: "reviewer", keep: ["lens"] });
  assert.match(rev[1].content, /< \/current_prompt>/);
  assert.match(rev[1].content, /<change_request source="reviewer">\nshorter/);
  assert.match(rev[1].content, /<keep>\n- lens/);
  assert.doesNotMatch(rev[0].content, /The prompt you are writing/);
  const crit = buildCritiqueMessages({ input: "a", draft: "b", brief, change: "c" });
  assert.match(crit[1].content, /<draft>\nb\n<\/draft>\n<change>\nc/);
  assert.throws(() => buildReviseMessages({ current: "x", change: " " }), /change request/);
});

function stub(replies) {
  const calls = [];
  return {
    calls,
    complete: async (messages, opts) => {
      calls.push({ messages, opts });
      const next = replies.shift();
      if (next === undefined) throw new Error("unexpected call");
      return typeof next === "function" ? next(messages) : next;
    },
  };
}

test("pipeline: analyze, write, pass on first review = 3 calls", async () => {
  const s = stub([BRIEF, "```\n提示词\n一只猫\n```", review(GOOD)]);
  const result = await runPipeline({ input: "窗台上的猫", complete: s.complete });
  assert.equal(result.text, "提示词\n一只猫");
  assert.equal(result.passed, true);
  assert.equal(s.calls.length, 3);
  assert.deepEqual(s.calls.map((c) => c.opts.temperature), [0.2, 0.7, 0]);
  assert.equal(result.brief.mode, "image");
  assert.equal(result.brief.decisions[0].source, "default");
});

test("pipeline: fail then pass = 5 calls, and a worse revision loses", async () => {
  const s = stub([BRIEF, "draft one", review(WEAK, { instruction: "name the light" }), "draft two", review(GOOD)]);
  const result = await runPipeline({ input: "猫", complete: s.complete });
  assert.equal(result.text, "draft two");
  assert.equal(s.calls.length, 5);
  assert.match(s.calls[3].messages[1].content, /<change_request source="reviewer">\nname the light/);
  assert.match(s.calls[3].messages[1].content, /<keep>\n- the light/);

  const worse = stub([BRIEF, "draft one", review(WEAK, { instruction: "x" }), "draft two",
    review({ ...WEAK, intent: 2 }, { instruction: "y" })]);
  const kept = await runPipeline({ input: "猫", complete: worse.complete });
  assert.equal(kept.text, "draft one");
  assert.equal(kept.passed, false);
  assert.equal(worse.calls.length, 5, "no unreviewed final revise");
});

test("pipeline: --once is 2 calls; explicit mode wins; bad JSON falls back", async () => {
  const once = stub([BRIEF, "only"]);
  const result = await runPipeline({ input: "猫", rounds: 1, mode: "user", complete: once.complete });
  assert.equal(result.text, "only");
  assert.equal(once.calls.length, 2);
  assert.equal(result.brief.mode, "user");
  assert.match(once.calls[0].messages[1].content, /<mode_request>\nuser/);
  const bad = stub(["nope", "still nope", "written"]);
  const fell = await runPipeline({ input: "x", rounds: 1, complete: bad.complete });
  assert.equal(fell.text, "written");
  assert.equal(fell.brief.mode, "user");
});

test("pipeline: answers from ask() become decisions; a mode change re-analyzes", async () => {
  const s = stub([BRIEF, "out", review(GOOD)]);
  const result = await runPipeline({
    input: "猫",
    complete: s.complete,
    ask: async () => ({ decisions: [{ id: "use", question: "?", answer: "手机壁纸", source: "user" }] }),
  });
  assert.equal(result.brief.decisions[0].source, "user");
  assert.match(s.calls[1].messages[1].content, /手机壁纸/);
  const m = stub([BRIEF, BRIEF.replace('"image",\n', '"image",'), "out"]);
  let asked = 0;
  const switched = await runPipeline({
    input: "猫",
    rounds: 1,
    complete: m.complete,
    ask: async () => (++asked === 1 ? { decisions: [], mode: "user" } : { decisions: [] }),
  });
  assert.equal(switched.brief.mode, "user");
  assert.equal(m.calls.length, 3);
  assert.match(m.calls[1].messages[1].content, /<mode_request>\nuser/);
});

test("runIterate: user change, reviewed, retried once if not applied", async () => {
  const s = stub(["v2", review(GOOD, { violations: [{ type: "change_not_applied", detail: "still long" }] }), "v3", review(GOOD)]);
  const result = await runIterate({ current: "v1", change: "只要五步", complete: s.complete });
  assert.equal(result.text, "v3");
  assert.match(s.calls[0].messages[1].content, /<change_request source="user">\n只要五步/);
  assert.match(s.calls[1].messages[1].content, /<change>\n只要五步/);
  assert.match(s.calls[2].messages[1].content, /只要五步/);
  const single = stub(["v2"]);
  assert.equal((await runIterate({ current: "v1", change: "x", rounds: 1, complete: single.complete })).text, "v2");
});

test("ask: Enter, number, free text, skip, and a low-confidence mode question", async () => {
  assert.deepEqual(readChoice("", ["a", "b"], 1), { answer: "b", source: "default" });
  assert.deepEqual(readChoice("1", ["a", "b"], 1), { answer: "a", source: "user" });
  assert.deepEqual(readChoice("my own", ["a", "b"], 0), { answer: "my own", source: "user" });
  assert.equal(readChoice("s", ["a", "b"], 0).skip, true);
  const lines = ["3", "2", "s"];
  const ask = createAsker({ question: async () => lines.shift(), write: () => {}, autoMode: true });
  const brief = normalizeBrief({
    mode: "user",
    mode_confidence: "low",
    questions: [
      { id: "a", question: "A?", options: ["x", "y"] },
      { id: "b", question: "B?", options: ["x", "y"] },
      { id: "c", question: "C?", options: ["x", "y"], default: 1 },
    ],
  });
  const out = await ask(brief);
  assert.equal(out.mode, "image");
  assert.deepEqual(out.decisions.map((d) => [d.id, d.answer, d.source]), [
    ["a", "y", "user"],
    ["b", "x", "default"],
    ["c", "y", "default"],
  ]);
});

test("clean strips only a wrapping fence", () => {
  assert.equal(clean("```markdown\n# A\n```"), "# A");
  assert.equal(clean("text with ```code``` inside"), "text with ```code``` inside");
});
