// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
//
// Up-front questions for -I. The analyst writes them; the client picks.
// Enter keeps the default, a number picks an option, other text is a free
// answer, and "s" takes the defaults for everything left.
import { KINDS } from "./templates.mjs";

/**
 * Read one answer against a list of options.
 * @param {string} line
 * @param {string[]} options
 * @param {number} def
 * @returns {{ answer: string, source: "user"|"default", skip?: boolean }}
 */
export function readChoice(line, options, def) {
  const text = String(line ?? "").trim();
  if (!text) return { answer: options[def], source: "default" };
  if (text === "s" || text === "S") return { answer: options[def], source: "default", skip: true };
  if (/^\d+$/.test(text)) {
    const index = Number(text) - 1;
    if (index >= 0 && index < options.length) {
      return { answer: options[index], source: index === def ? "default" : "user" };
    }
  }
  return { answer: text, source: "user" };
}

/**
 * Build the ask() hook for runPipeline.
 * @param {{ question: (prompt: string) => Promise<string>, write: (text: string) => void, autoMode: boolean }} io
 */
export function createAsker({ question, write, autoMode }) {
  return async function ask(brief) {
    const items = [];
    if (autoMode && brief.mode_confidence === "low") {
      const options = [...KINDS];
      items.push({ id: "_mode", question: "Which kind of prompt?", options, default: Math.max(options.indexOf(brief.mode), 0) });
    }
    items.push(...(brief.questions ?? []));
    const decisions = [];
    let mode;
    if (!items.length) return { decisions };
    write(`popt: ${items.length} quick question${items.length > 1 ? "s" : ""}. Enter keeps the default, s skips the rest.\n`);
    let skipping = false;
    for (const [i, item] of items.entries()) {
      let picked = { answer: item.options[item.default], source: "default" };
      if (!skipping) {
        const lines = item.options.map((option, k) => `   ${k + 1}) ${option}${k === item.default ? "  ← default" : ""}`);
        write(`[${i + 1}/${items.length}] ${item.question}\n${lines.join("\n")}\n   or type your own answer\n`);
        picked = readChoice(await question("> "), item.options, item.default);
        if (picked.skip) skipping = true;
      }
      if (item.id === "_mode") {
        if (KINDS.includes(picked.answer)) mode = picked.answer;
        continue;
      }
      decisions.push({ id: item.id, question: item.question, answer: picked.answer, source: picked.source });
    }
    return { decisions, mode };
  };
}
