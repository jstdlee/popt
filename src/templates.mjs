// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
//
// Message builders. The prompt text lives in prompts.mjs and is this
// program's own; it is not copied from linshenkx/prompt-optimizer
// (Copyright (C) 2025 linshenkx, AGPL-3.0-only).
import {
  ANALYZER,
  MODE_IMAGE,
  MODE_SYSTEM,
  MODE_USER,
  PLAYBOOKS,
  PRINCIPLES,
  REVISER_CONTRACT,
  REVISER_INTRO,
  WRITER_CONTRACT,
  WRITER_INTRO,
} from "./prompts.mjs";

/** @typedef {"system"|"user"|"image"} Kind */

/** Modes the CLI accepts. */
export const MODES = ["auto", "system", "user", "image"];
export const KINDS = ["system", "user", "image"];

const MODE_BODY = { system: MODE_SYSTEM, user: MODE_USER, image: MODE_IMAGE };

/**
 * Neutralize a closing fence so the model still sees the user's text as data.
 * @param {string} tag
 * @param {string} text
 * @param {string} [attrs]
 */
export function fence(tag, text, attrs = "") {
  const close = `</${tag}>`;
  const safe = String(text).replaceAll(close, `< /${tag}>`);
  return `<${tag}${attrs ? ` ${attrs}` : ""}>\n${safe}\n${close}`;
}

/** The brief as the writer and reviewer see it: no question menu. */
export function briefForPrompt(brief) {
  if (!brief) return "";
  const { questions, ...rest } = brief;
  return JSON.stringify(rest, null, 2);
}

/**
 * Craft references for one call. The agent playbook joins every system prompt.
 * @param {{ mode?: string, domain?: string } | null | undefined} brief
 * @returns {string[]}
 */
export function selectPlaybooks(brief) {
  const keys = [];
  if (brief?.mode === "system") keys.push("agent");
  if (brief?.domain && !keys.includes(brief.domain)) keys.push(brief.domain);
  return keys.filter((key) => key !== "image" && key !== "other" && PLAYBOOKS[key]);
}

function craft(brief) {
  return selectPlaybooks(brief).map((key) => `Craft reference: ${key}\n${PLAYBOOKS[key]}`);
}

/**
 * @param {{ input: string, modeRequest?: string }} opts
 */
export function buildAnalyzeMessages({ input, modeRequest = "auto" }) {
  const playbooks = Object.entries(PLAYBOOKS).map(([key, text]) => `${key}\n${text}`).join("\n\n");
  return [
    { role: "system", content: `${ANALYZER}\n\nDomain playbooks\n\n${playbooks}` },
    {
      role: "user",
      content: `${fence("mode_request", KINDS.includes(modeRequest) ? modeRequest : "auto")}\n${fence("original_prompt", input)}`,
    },
  ];
}

/**
 * @param {{ input: string, brief: object & { mode: Kind } }} opts
 */
export function buildGenerateMessages({ input, brief }) {
  if (!KINDS.includes(brief?.mode)) throw new Error(`unknown mode: ${brief?.mode}`);
  const system = [WRITER_INTRO, PRINCIPLES, MODE_BODY[brief.mode], ...craft(brief), WRITER_CONTRACT].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: `${fence("original_prompt", input)}\n${fence("brief", briefForPrompt(brief))}` },
  ];
}

/**
 * @param {{ current: string, change: string, source?: "user"|"reviewer", keep?: string[], input?: string, brief?: object | null, mode?: string }} opts
 */
export function buildReviseMessages({ current, change, source = "user", keep = [], input, brief, mode }) {
  if (!change || !String(change).trim()) throw new Error("iterate mode needs a change request");
  const kind = KINDS.includes(brief?.mode) ? brief.mode : KINDS.includes(mode) ? mode : "";
  const parts = [REVISER_INTRO, PRINCIPLES];
  if (kind) parts.push(MODE_BODY[kind], ...craft({ ...brief, mode: kind }));
  parts.push(REVISER_CONTRACT);
  const data = [];
  if (input && String(input).trim()) data.push(fence("original_prompt", input));
  if (brief) data.push(fence("brief", briefForPrompt(brief)));
  data.push(fence("current_prompt", current));
  data.push(fence("change_request", change, `source="${source === "reviewer" ? "reviewer" : "user"}"`));
  const kept = (keep ?? []).filter(Boolean);
  if (kept.length) data.push(fence("keep", kept.map((item) => `- ${item}`).join("\n")));
  return [
    { role: "system", content: parts.join("\n\n") },
    { role: "user", content: data.join("\n") },
  ];
}
