// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
//
// Review step in the analyze → write → critique → revise chain. The reviewer
// scores the draft; pass/fail is decided here in code, not by the model.
import { extractJson } from "./brief.mjs";
import { CRITIQUE } from "./prompts.mjs";
import { briefForPrompt, fence } from "./templates.mjs";

export const BLOCKING = new Set([
  "dropped_constraint",
  "contradiction",
  "fabricated_fact",
  "wrong_strategy",
  "answered_task",
  "wrong_language",
  "change_not_applied",
]);
export const WEIGHT = { intent: 3, fidelity: 3, craft: 2, specificity: 2, executability: 1, format: 1 };
export const MAX_TOTAL = 60;
const HINT = {
  intent: "Serve the purpose behind the request and the downstream use, not only its literal words.",
  fidelity: "Restore every stated fact at full strength and replace invented client facts with placeholders.",
  craft: "Turn the field's expert method into specific instructions for this request.",
  specificity: "Decide what is still left open or offered as a menu, or, for reusable prompts, replace the one invented scenario with rules.",
  executability: "Remove conflicts and padding so every sentence is actionable.",
  format: "Make it paste-ready in the right shape for its kind.",
};

/**
 * @param {{ input: string, draft: string, brief?: object | null, change?: string }} opts
 */
export function buildCritiqueMessages({ input, draft, brief, change }) {
  const parts = [];
  if (input && String(input).trim()) parts.push(fence("original_prompt", input));
  if (brief) parts.push(fence("brief", briefForPrompt(brief)));
  parts.push(fence("draft", draft));
  if (change && String(change).trim()) parts.push(fence("change", change));
  return [
    { role: "system", content: CRITIQUE },
    { role: "user", content: parts.join("\n") },
  ];
}

const score = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.round(n)));
};

/**
 * @param {string} text
 * @returns {{ ok: boolean, pass: boolean, blocked: boolean, total: number, scores: Record<string, number>, violations: {type: string, detail: string}[], weakest: string[], keep: string[], instruction: string }}
 */
export function parseCritique(text) {
  const data = extractJson(text);
  if (!data) {
    return { ok: false, pass: true, blocked: false, total: 0, scores: {}, violations: [], weakest: [], keep: [], instruction: "" };
  }
  const list = (value) => (Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : []);
  const violations = (Array.isArray(data.violations) ? data.violations : [])
    .map((v) => ({ type: String(v?.type ?? "").trim(), detail: String(v?.detail ?? "").trim() }))
    .filter((v) => v.type);
  const scores = {};
  for (const key of Object.keys(WEIGHT)) scores[key] = score(data.scores?.[key]);
  const blocked = violations.some((v) => BLOCKING.has(v.type));
  const total = Object.entries(WEIGHT).reduce((sum, [key, w]) => sum + w * scores[key], 0) - (blocked ? 15 : 0);
  const pass = !blocked
    && scores.intent >= 4 && scores.fidelity >= 4 && scores.craft >= 4 && scores.specificity >= 4
    && scores.executability >= 3 && scores.format >= 3;
  const weakest = list(data.weakest);
  const keep = list(data.keep);
  let instruction = typeof data.instruction === "string" ? data.instruction.trim() : "";
  if (!pass && !instruction) {
    instruction = [...violations.map((v) => `${v.type}: ${v.detail}`), ...weakest.map((w) => `Improve: ${w}`)].join("\n");
  }
  if (!pass && !instruction) {
    const low = Object.entries(scores).filter(([k, v]) => v < (k === "executability" || k === "format" ? 3 : 4));
    instruction = `Raise ${low.map(([k, v]) => `${k} (now ${v}/5)`).join(", ")}: ${low.map(([k]) => HINT[k]).join(" ")}`;
  }
  if (pass) instruction = "";
  return { ok: true, pass, blocked, total, scores, violations, weakest, keep, instruction };
}

/** "46/60 fail — craft 3, specificity 3" */
export function critiqueSummary(review) {
  if (!review.ok) return "unreadable review; keeping the draft";
  const low = Object.entries(review.scores).filter(([, v]) => v < 4).map(([k, v]) => `${k} ${v}`);
  const blocking = review.violations.filter((v) => BLOCKING.has(v.type)).map((v) => v.type);
  const notes = [...blocking, ...low].join(", ");
  return `${review.total}/${MAX_TOTAL} ${review.pass ? "pass" : "fail"}${notes ? ` — ${notes}` : ""}`;
}
