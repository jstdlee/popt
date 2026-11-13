// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
//
// analyze → (ask) → write → critique → revise → critique, keeping the best
// reviewed candidate. Same product idea as prompt-optimizer (one optimize call
// is not the result), with an intake brief in front and scored selection after.
import { defaultDecisions, extractJson, fallbackBrief, normalizeBrief } from "./brief.mjs";
import { buildCritiqueMessages, parseCritique } from "./critique.mjs";
import { KINDS, buildAnalyzeMessages, buildGenerateMessages, buildReviseMessages } from "./templates.mjs";

export const TEMPERATURE = { analyze: 0.2, generate: 0.7, critique: 0, revise: 0.4 };

/** Trim, and drop one Markdown fence that wraps the whole reply. */
export function clean(text) {
  const trimmed = String(text ?? "").trim();
  const match = trimmed.match(/^```[\w-]*\n([\s\S]*?)\n```$/);
  return (match ? match[1] : trimmed).trim();
}

function nonEmpty(text) {
  const out = clean(text);
  if (!out) throw new Error("empty completion");
  return out;
}

/**
 * Ask the analyst for a brief. Retries once on unreadable JSON, then falls back.
 * @param {{ input: string, modeRequest?: string, complete: Function }} opts
 */
export async function analyze({ input, modeRequest = "auto", complete }) {
  const messages = buildAnalyzeMessages({ input, modeRequest });
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = extractJson(await complete(messages, { temperature: TEMPERATURE.analyze, phase: "analyze" }));
    if (raw) return { brief: normalizeBrief(raw, { modeRequest }), ok: true };
  }
  return { brief: fallbackBrief(modeRequest), ok: false };
}

/**
 * Critique candidates and revise until one passes or the budget is spent.
 * Every returned candidate has been reviewed; the best total wins.
 */
async function reviewLoop({ input, brief, first, change, rounds, complete, onStep, mode }) {
  let text = first;
  let best = null;
  let n = 1;
  for (; n <= rounds; n++) {
    onStep({ phase: "critique", round: n, limit: rounds });
    const review = parseCritique(await complete(
      buildCritiqueMessages({ input, brief, draft: text, change }),
      { temperature: TEMPERATURE.critique, phase: "critique" },
    ));
    onStep({ phase: "critique-result", round: n, limit: rounds, critique: review });
    if (!best || review.total > best.review.total) best = { text, review };
    if (review.pass || !review.ok || n === rounds || !review.instruction) break;
    onStep({ phase: "revise", round: n + 1, limit: rounds });
    text = nonEmpty(await complete(buildReviseMessages({
      input,
      brief,
      mode,
      current: text,
      change: change ? `${review.instruction}\n\nThe client's own change, which must be carried out: ${change}` : review.instruction,
      keep: review.keep,
      source: "reviewer",
    }), { temperature: TEMPERATURE.revise, phase: "revise" }));
  }
  return { text: best.text, passed: best.review.pass, candidates: Math.min(n, rounds), review: best.review };
}

/**
 * @param {{
 *   mode?: string, input: string, rounds?: number, lang?: string,
 *   complete: (messages: {role: string, content: string}[], opts?: { temperature?: number, phase?: string }) => Promise<string>,
 *   ask?: (brief: object) => Promise<{ decisions: object[], mode?: string }>,
 *   onStep?: (event: object) => void,
 * }} opts
 */
export async function runPipeline(opts) {
  const rounds = Math.max(1, opts.rounds ?? 2);
  const onStep = opts.onStep ?? (() => {});
  const modeRequest = KINDS.includes(opts.mode) ? opts.mode : "auto";
  const { complete, input } = opts;

  onStep({ phase: "analyze" });
  let { brief, ok } = await analyze({ input, modeRequest, complete });
  if (!ok) onStep({ phase: "analyze-fallback" });
  if (opts.lang) brief.language = opts.lang;

  if (opts.ask) {
    const answer = await opts.ask(brief);
    if (answer.mode && answer.mode !== brief.mode && KINDS.includes(answer.mode)) {
      onStep({ phase: "analyze", reason: "mode changed" });
      ({ brief } = await analyze({ input, modeRequest: answer.mode, complete }));
      if (opts.lang) brief.language = opts.lang;
      brief.decisions = (await opts.ask({ ...brief, mode_confidence: "high" })).decisions;
    } else {
      brief.decisions = answer.decisions;
    }
  } else {
    brief.decisions = defaultDecisions(brief);
  }
  onStep({ phase: "brief", brief });

  onStep({ phase: "draft", round: 1, limit: rounds });
  const first = nonEmpty(await complete(
    buildGenerateMessages({ input, brief }),
    { temperature: TEMPERATURE.generate, phase: "generate" },
  ));
  if (rounds === 1) return { text: first, brief, passed: false, candidates: 1 };
  const result = await reviewLoop({ input, brief, first, rounds, complete, onStep });
  return { ...result, brief };
}

/**
 * Apply a client's change to an existing prompt (-i), then review that the
 * change landed. With rounds 1 it is a single revise call.
 * @param {{ current: string, change: string, mode?: string, brief?: object | null, input?: string, rounds?: number, complete: Function, onStep?: (event: object) => void }} opts
 */
export async function runIterate(opts) {
  const rounds = Math.max(1, opts.rounds ?? 2);
  const onStep = opts.onStep ?? (() => {});
  const { complete, change } = opts;
  const brief = opts.brief ?? null;
  onStep({ phase: "revise", round: 1, limit: rounds });
  const first = nonEmpty(await complete(buildReviseMessages({
    current: opts.current,
    change,
    source: "user",
    input: opts.input,
    brief,
    mode: opts.mode,
  }), { temperature: TEMPERATURE.revise, phase: "revise" }));
  if (rounds === 1) return { text: first, brief, passed: false, candidates: 1 };
  const result = await reviewLoop({
    input: opts.input || opts.current,
    brief,
    first,
    change,
    rounds,
    complete,
    onStep,
    mode: opts.mode,
  });
  return { ...result, brief };
}
