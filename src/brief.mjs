// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei
//
// The analyst's brief: parse, repair, and fill defaults.
import { KINDS } from "./templates.mjs";

const DOMAINS = ["image", "coding", "writing", "marketing", "data", "education", "business", "translation", "agent", "other"];
const STRATEGIES = ["concretize", "generalize", "preserve"];
const CONFIDENCE = ["high", "medium", "low"];
const JOBS = ["photo", "phone_snapshot", "identity_portrait", "illustration", "graphic_design", "render_3d"];

/** First "{" to last "}", parsed. Returns null when there is no object. */
export function extractJson(text) {
  const raw = String(text ?? "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(raw.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

const str = (value) => (typeof value === "string" ? value.trim() : "");
const strings = (value) => (Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean) : []);
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/** @param {string} modeRequest */
export function fallbackBrief(modeRequest = "auto") {
  const mode = KINDS.includes(modeRequest) ? modeRequest : "user";
  return normalizeBrief({}, { modeRequest: mode });
}

/**
 * @param {object | null} raw parsed analyzer JSON
 * @param {{ modeRequest?: string }} [opts]
 */
export function normalizeBrief(raw, { modeRequest = "auto" } = {}) {
  const data = raw && typeof raw === "object" ? raw : {};
  const explicit = KINDS.includes(modeRequest);
  const mode = explicit ? modeRequest : pick(data.mode, KINDS, "user");
  const placeholders = Array.isArray(data.placeholders)
    ? data.placeholders
      .map((p) => ({ name: str(p?.name).replace(/[^\w]/g, "_"), meaning: str(p?.meaning) }))
      .filter((p) => p.name)
    : [];
  const questions = (Array.isArray(data.questions) ? data.questions : [])
    .map((q, i) => {
      const options = strings(q?.options);
      const def = Number.isInteger(q?.default) ? q.default : 0;
      return {
        id: str(q?.id) || `q${i + 1}`,
        question: str(q?.question),
        options,
        default: Math.min(Math.max(def, 0), Math.max(options.length - 1, 0)),
      };
    })
    .filter((q) => q.question && q.options.length >= 2 && q.options.length <= 4)
    .slice(0, 3);
  let image = null;
  if (mode === "image") {
    const img = data.image && typeof data.image === "object" ? data.image : {};
    image = {
      job: pick(img.job, JOBS, "photo"),
      real_person: img.real_person === true,
      has_reference: img.has_reference === true,
      aspect_ratio: str(img.aspect_ratio),
      text_in_image: str(img.text_in_image),
    };
  }
  return {
    language: str(data.language),
    hard_constraints: strings(data.hard_constraints),
    mode,
    mode_confidence: explicit ? "high" : pick(data.mode_confidence, CONFIDENCE, "low"),
    domain: pick(data.domain, DOMAINS, mode === "image" ? "image" : "other"),
    subdomain: str(data.subdomain),
    deliverable: str(data.deliverable),
    target: str(data.target),
    implicit_goal: str(data.implicit_goal),
    strategy: pick(data.strategy, STRATEGIES, "concretize"),
    strategy_reason: str(data.strategy_reason),
    assumptions: strings(data.assumptions),
    placeholders,
    expert_practices: strings(data.expert_practices),
    risks: strings(data.risks),
    image,
    questions,
  };
}

/** Answers that take every question's default. */
export function defaultDecisions(brief) {
  return (brief?.questions ?? []).map((q) => ({
    id: q.id,
    question: q.question,
    answer: q.options[q.default] ?? "",
    source: "default",
  }));
}

/** One stderr line: "image/photo · concretize · zh · 3:2". */
export function briefSummary(brief) {
  const kind = brief.mode === "image" && brief.image ? `image/${brief.image.job}` : `${brief.mode}/${brief.domain}`;
  return [kind, brief.strategy, brief.language || "-", brief.image?.aspect_ratio].filter(Boolean).join(" · ");
}
