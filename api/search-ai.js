const PRIMARY_TIMEOUT_MS = 4500;
const BACKUP_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`Request timed out after ${timeoutMs}ms`);
      timeoutError.code = "TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildPrompt(query, candidates) {
  const compactCandidates = candidates.map((item) => ({
    index: item.originalIndex,
    law: item.law || "",
    section: item.section || "",
    short: item.short || "",
    details: (item.details || "").slice(0, 1800)
  }));

  return `
Ти допомагаєш юридичному сайту України знаходити найбільш релевантні статті закону.

Користувач описав ситуацію:
"${query}"

Нижче список кандидатів.

Кожен кандидат має поля:
- law — назва статті або коротка назва норми
- short — короткий опис
- details — повний текст або основний зміст
- section — назва закону або кодексу

Завдання:
проаналізуй зміст ситуації користувача і вибери найбільш релевантні статті не лише за ключовими словами, а й за змістом, юридичним сенсом, близькими формулюваннями, можливими синонімами і навіть якщо в запиті є помилки.

Критерії:
1. УСІ поля важливі: law, short, details, section.
2. Особливо важливо, щоб стаття підходила саме по суті ситуації.
3. Якщо користувач описав подію іншими словами, але сенс той самий — це релевантний результат.
4. Якщо в запиті є орфографічні помилки або розмовна форма — все одно намагайся знайти правильну статтю.
5. Віддавай перевагу більш точним і конкретним нормам.
6. Не обирай слабко релевантні результати, якщо є сильніші.
7. Якщо є стаття, яка прямо описує право, обов’язок, заборону, недоторканність або правовий статус у ситуації користувача — піднімай її вище.
8. score від 0 до 100:
   - 90-100: майже точне попадання по ситуації
   - 70-89: сильна релевантність
   - 50-69: часткова, але корисна релевантність
   - нижче 50: слабка релевантність

Поверни тільки JSON без будь-якого іншого тексту.
НІКОЛИ не обгортай JSON у \`\`\`json або \`\`\`.
Поверни тільки чистий JSON-об’єкт.

Формат:
{
  "results": [
    { "index": 12, "score": 95, "reason": "коротка причина" },
    { "index": 7, "score": 82, "reason": "коротка причина" }
  ]
}

Кандидати:
${JSON.stringify(compactCandidates, null, 2)}
`.trim();
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  if (!text) return null;

  const cleaned = String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const direct = tryParseJson(cleaned);
  if (direct) return direct;

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const sliced = cleaned.slice(firstBrace, lastBrace + 1);
  return tryParseJson(sliced);
}

function normalizeResults(parsed) {
  const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];

  return rawResults
    .filter((item) => item && typeof item.index === "number")
    .map((item) => ({
      index: item.index,
      score: Number(item.score) || 0,
      reason: String(item.reason || "")
    }))
    .filter((item) => item.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function buildError(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  return error;
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  if (!apiKey) {
    throw buildError("Gemini API key is missing", {
      provider: "gemini",
      status: 500
    });
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2
        }
      })
    },
    PRIMARY_TIMEOUT_MS
  );

  const raw = await response.text();

  if (!response.ok) {
    throw buildError("Gemini request failed", {
      provider: "gemini",
      status: response.status,
      raw
    });
  }

  const data = tryParseJson(raw);
  if (!data) {
    throw buildError("Gemini returned non-JSON response", {
      provider: "gemini",
      status: 500,
      raw
    });
  }

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("")
      .trim() || "";

  const parsed = extractJsonObject(text);

  if (!parsed) {
    throw buildError("Gemini returned invalid model JSON", {
      provider: "gemini",
      status: 500,
      raw: text
    });
  }

  return {
    provider: "gemini",
    results: normalizeResults(parsed)
  };
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    throw buildError("OpenAI API key is missing", {
      provider: "openai",
      status: 500
    });
  }

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.2,
        response_format: { type: "json_object" }
      })
    },
    BACKUP_TIMEOUT_MS
  );

  const raw = await response.text();

  if (!response.ok) {
    throw buildError("OpenAI request failed", {
      provider: "openai",
      status: response.status,
      raw
    });
  }

  const data = tryParseJson(raw);
  if (!data) {
    throw buildError("OpenAI returned non-JSON response", {
      provider: "openai",
      status: 500,
      raw
    });
  }

  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  const parsed = extractJsonObject(text);

  if (!parsed) {
    throw buildError("OpenAI returned invalid model JSON", {
      provider: "openai",
      status: 500,
      raw: text
    });
  }

  return {
    provider: "openai",
    results: normalizeResults(parsed)
  };
}

function logProviderError(label, error) {
  console.error(`${label}:`, {
    message: error?.message || "Unknown error",
    provider: error?.provider || "unknown",
    status: error?.status || null,
    code: error?.code || null,
    raw: error?.raw || null
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { query, candidates } = req.body || {};

    if (!query || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: "No query or candidates" });
    }

    const prompt = buildPrompt(query, candidates);

    try {
      const geminiResult = await callGemini(prompt);

      return res.status(200).json({
        results: geminiResult.results,
        provider: geminiResult.provider
      });
    } catch (geminiError) {
      logProviderError("Primary Gemini error", geminiError);
    }

    try {
      const openaiResult = await callOpenAI(prompt);

      return res.status(200).json({
        results: openaiResult.results,
        provider: openaiResult.provider
      });
    } catch (openaiError) {
      logProviderError("Backup OpenAI error", openaiError);
    }

    return res.status(200).json({
      results: [],
      provider: "none",
      error: "Both providers failed"
    });
  } catch (error) {
    console.error("search-ai fatal error:", {
      message: error?.message || "Unknown fatal error"
    });

    return res.status(200).json({
      results: [],
      provider: "none",
      error: error?.message || "Server error"
    });
  }
}
