// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
//
// Draft, then critique, then revise. Same product loop as prompt-optimizer:
// one optimize call is not the result; a failed review becomes the next iterate input.
import { buildCritiqueMessages, parseCritique } from "./critique.mjs";
import { buildMessages } from "./templates.mjs";

/**
 * @param {{ mode: string, input: string, iterate?: string, rounds?: number, complete: (messages: {role: string, content: string}[]) => Promise<string>, onStep?: (event: object) => void }} opts
 */
export async function runPipeline(opts) {
  const limit = Math.max(1, opts.rounds ?? 2);
  const onStep = opts.onStep ?? (() => {});
  let draft = "";
  let change = opts.iterate?.trim() ?? "";
  for (let round = 1; round <= limit; round++) {
    const revising = round > 1 || opts.mode === "iterate";
    const messages = revising
      ? buildMessages({ mode: "iterate", input: round > 1 ? draft : opts.input, iterate: change })
      : buildMessages({ mode: opts.mode, input: opts.input });
    onStep({ phase: revising ? "revise" : "draft", round, limit });
    draft = String(await opts.complete(messages)).trim();
    if (!draft) throw new Error("empty completion");
    if (limit === 1) return { text: draft, roundsUsed: 1, passed: false };
    onStep({ phase: "critique", round, limit });
    const critique = parseCritique(await opts.complete(buildCritiqueMessages({
      original: opts.input,
      draft,
      change: opts.iterate,
    })));
    onStep({ phase: "critique-result", round, limit, critique });
    if (critique.pass || !critique.instruction.trim()) {
      return { text: draft, roundsUsed: round, passed: critique.pass };
    }
    change = critique.instruction;
    if (round === limit) {
      onStep({ phase: "revise", round: round + 1, limit });
      draft = String(await opts.complete(buildMessages({
        mode: "iterate",
        input: draft,
        iterate: change,
      }))).trim();
      if (!draft) throw new Error("empty completion");
      return { text: draft, roundsUsed: round, passed: false };
    }
  }
  return { text: draft, roundsUsed: limit, passed: false };
}
