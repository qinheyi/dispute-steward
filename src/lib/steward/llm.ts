/**
 * MiniMax OpenAI-compatible chat client (same pattern as Entry Gate / Encore).
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  [extra: string]: unknown;
}

export interface ChatResult {
  text: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export function llmEnabled(): boolean {
  if (process.env.DISPUTE_STEWARD_LLM === "0") return false;
  return Boolean(process.env.MINIMAX_API_KEY);
}

function stripThinking(text: string | null | undefined): string {
  if (!text) return "";
  let t = text.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
  let end = -1;
  for (const m of t.matchAll(/<\/think(?:ing)?>/gi)) end = (m.index ?? 0) + m[0].length;
  if (end >= 0) t = t.slice(end);
  const open = t.search(/<think(?:ing)?>/i);
  if (open >= 0) t = t.slice(0, open);
  return t.trim();
}

export async function chatCompletion(opts: {
  messages: ChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ChatResult> {
  const key = process.env.MINIMAX_API_KEY;
  if (!key) throw new Error("MINIMAX_API_KEY not set");
  const baseUrl = (process.env.MINIMAX_BASE_URL || "https://api.minimax.cn/v1").replace(/\/+$/, "");
  const model = process.env.MINIMAX_MODEL || "MiniMax-M3";

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: 0.4,
    max_completion_tokens: opts.maxTokens ?? 600,
    reasoning_split: true,
  };
  if (/^MiniMax-M3$/i.test(model) && process.env.MINIMAX_THINKING !== "adaptive") {
    body.thinking = { type: "disabled" };
  }

  const ctrl = new AbortController();
  const envTimeout = Number(process.env.LLM_TIMEOUT_MS) || 60_000;
  const timer = setTimeout(() => ctrl.abort(), Math.min(envTimeout, opts.timeoutMs ?? envTimeout));
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const raw = await res.text();
    if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}: ${raw.slice(0, 300)}`);
    const data = JSON.parse(raw);
    const br = data.base_resp;
    if (br && typeof br.status_code === "number" && br.status_code !== 0) {
      throw new Error(`MiniMax error ${br.status_code}: ${String(br.status_msg ?? "").slice(0, 200)}`);
    }
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("MiniMax response had no choices[0].message");
    return {
      text: stripThinking(typeof message.content === "string" ? message.content : ""),
      usage: data.usage,
    };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("MiniMax request timed out");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
