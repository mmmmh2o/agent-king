export interface LLMResponse {
  content: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * 调用 OpenAI 兼容 API (async fetch, 非阻塞)
 */
export async function call_llm(
  prompt: string,
  system?: string,
  opts?: { model?: string; temperature?: number; max_tokens?: number }
): Promise<LLMResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model = opts?.model || process.env.LLM_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 未设置");
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  const body = JSON.stringify({
    model,
    messages,
    temperature: opts?.temperature ?? 0.3,
    max_tokens: opts?.max_tokens ?? 4096,
  });

  const url = `${baseUrl}/chat/completions`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`LLM API HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  const parsed = await resp.json() as any;

  if (parsed.error) {
    throw new Error(`LLM API 错误: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }

  return {
    content: parsed.choices?.[0]?.message?.content || "",
    usage: parsed.usage,
  };
}
