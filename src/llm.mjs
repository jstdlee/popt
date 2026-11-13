// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 leilei

/** Pull visible text out of a chat-completions JSON body. Ignores reasoning fields. */
export function messageText(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message ?? choice?.delta ?? {};
  const content = message.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("");
  }
  return "";
}

/**
 * Incremental SSE parser. Calls onEvent with each payload string, including "[DONE]".
 * @param {(data: string) => void} onEvent
 */
export function createSseParser(onEvent) {
  let buf = "";
  const drain = (final) => {
    if (final && buf.length) buf += "\n";
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, "");
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      onEvent(line.slice(5).trim());
    }
  };
  return {
    push(chunk) {
      buf += chunk;
      drain(false);
    },
    flush() {
      drain(true);
    },
  };
}

function redact(text, apiKey) {
  if (!apiKey) return text;
  return text.split(apiKey).join("<redacted>");
}

/**
 * @param {{ baseUrl: string, apiKey: string, model: string, messages: {role: string, content: string}[], stream?: boolean, effort?: string, temperature?: number, maxTokens?: number, signal?: AbortSignal, onDelta?: (s: string) => void, fetchImpl?: typeof fetch }} opts
 */
export async function complete(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 32768,
    stream: Boolean(opts.stream),
  };
  if (opts.effort) body.reasoning_effort = opts.effort;
  const response = await fetchImpl(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "popt",
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(redact(`LLM ${response.status}: ${errText.slice(0, 500)}`, opts.apiKey));
  }
  if (!opts.stream) {
    return messageText(await response.json());
  }
  let full = "";
  const emit = (piece) => {
    full += piece;
    if (opts.onDelta) opts.onDelta(piece);
  };
  const parser = createSseParser((data) => {
    if (!data || data === "[DONE]") return;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const piece = messageText(json);
    if (piece) emit(piece);
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("LLM stream has no body");
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.flush();
  return full;
}
