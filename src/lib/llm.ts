import { execSync } from "child_process";

export interface LLMResponse {
  content: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * 调用 OpenAI 兼容 API
 * 支持 OpenAI / DeepSeek / 任何 OpenAI 兼容服务
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

  const curlCmd = `curl -s -X POST ${baseUrl}/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${apiKey}" \
    -d '${body.replace(/'/g, "'\\''")}'`;

  try {
    const raw = execSync(curlCmd, { encoding: "utf-8", timeout: 120_000 });
    const parsed = JSON.parse(raw);

    if (parsed.error) {
      throw new Error(`LLM API 错误: ${parsed.error.message || JSON.stringify(parsed.error)}`);
    }

    return {
      content: parsed.choices?.[0]?.message?.content || "",
      usage: parsed.usage,
    };
  } catch (e) {
    if ((e as Error).message.includes("LLM API 错误")) throw e;
    throw new Error(`LLM 调用失败: ${(e as Error).message}`);
  }
}
