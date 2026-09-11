// AI credentials remain inside edge functions. Bound external calls so requests
// cannot hang indefinitely or strand a completed client check-in.
export async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
}

type ModelResult = { text: string } | { status: number; error: string; message: string };

export async function callModel(system: string, user: string): Promise<ModelResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

  if (LOVABLE_API_KEY) {
    const response = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        max_tokens: 1200,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (response.status === 429) {
      return {
        status: 429,
        error: "rate_limited",
        message: "The AI is handling a lot right now — try again in a moment.",
      };
    }
    if (response.status === 402) {
      return {
        status: 402,
        error: "payment_required",
        message: "AI credits are exhausted. Add credits to your workspace to continue.",
      };
    }
    if (!response.ok) {
      return { status: 502, error: "ai_error", message: `AI gateway error (${response.status}).` };
    }
    const data = await response.json();
    return { text: data.choices?.[0]?.message?.content ?? "" };
  }

  if (GEMINI_API_KEY) {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 1200 },
        }),
      }
    );
    if (response.status === 429) {
      return {
        status: 429,
        error: "rate_limited",
        message: "The AI is handling a lot right now — try again in a moment.",
      };
    }
    if (!response.ok) {
      return { status: 502, error: "ai_error", message: `Gemini error (${response.status}).` };
    }
    const data = await response.json();
    return { text: data.candidates?.[0]?.content?.parts?.[0]?.text ?? "" };
  }

  return { status: 503, error: "no_ai_key", message: "No AI key is configured on the server." };
}

export function parseModelJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

