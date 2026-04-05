const PRIMARY_TIMEOUT_MS = 4500;
const BACKUP_TIMEOUT_MS = 5000;

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function shouldFallback(status, errorText = "") {
  if (!status) return true;
  if (status === 408 || status === 409 || status === 423 || status === 425 || status === 429) return true;
  if (status >= 500) return true;

  const text = String(errorText || "").toLowerCase();
  if (
    text.includes("rate limit") ||
    text.includes("quota") ||
    text.includes("resource exhausted") ||
    text.includes("temporarily unavailable") ||
    text.includes("overloaded")
  ) {
    return true;
  }

  return false;
}

function buildPrompt(query, candidates) {
  const compactCandidates = candidates.map(item => ({
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
`;
}

function extractJsonObject(text) {
  if (!text) return null;

  const cleaned = String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!cleaned.startsWith("{")) return null;

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function normalizeResults(parsed) {
  let results = Array.isArray(parsed?.results) ? parsed.results : [];

  results = results
    .filter(item => typeof item.index === "number")
    .filter(item => typeof item.score === "number")
    .map(item => ({
      index: item.index,
      score: item.score,
      reason: item.reason || ""
    }))
    .filter(item => item.score >= 45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return results;
}

async function callGemini(prompt) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

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
            parts: [
              { text: prompt }
            ]
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
    const error = new Error("Gemini failed");
    error.status = response.status;
    error.raw = raw;
    throw error;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const error = new Error("Gemini returned invalid JSON");
    error.status = 500;
    error.raw = raw;
    throw error;
  }

  const text =
    data?.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("").trim() || "";

  const parsed = extractJsonObject(text);

  if (!parsed) {
    const error = new Error("Gemini returned invalid model JSON");
    error.status = 500;
    error.raw = text;
    throw error;
  }

  return {
    provider: "gemini",
    results: normalizeResults(parsed)
  };
}

async function callOpenAI(prompt) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      })
    },
    BACKUP_TIMEOUT_MS
  );

  const raw = await response.text();

  if (!response.ok) {
    const error = new Error("OpenAI backup failed");
    error.status = response.status;
    error.raw = raw;
    throw error;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const error = new Error("OpenAI returned invalid JSON");
    error.status = 500;
    error.raw = raw;
    throw error;
  }

  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  const parsed = extractJsonObject(text);

  if (!parsed) {
    const error = new Error("OpenAI returned invalid model JSON");
    error.status = 500;
    error.raw = text;
    throw error;
  }

  return {
    provider: "openai",
    results: normalizeResults(parsed)
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { query, candidates } = req.body;

    if (!query || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: "No query or candidates" });
    }

    const prompt = buildPrompt(query, candidates);

    try {
      const primaryResult = await callGemini(prompt);

      return res.status(200).json({
        results: primaryResult.results,
        provider: primaryResult.provider
      });
    } catch (primaryError) {
      console.error("Primary Gemini error:", {
        message: primaryError.message,
        status: primaryError.status,
        raw: primaryError.raw
      });

      if (!shouldFallback(primaryError.status, primaryError.raw)) {
        return res.status(500).json({
          error: "Primary provider failed",
          message: primaryError.message
        });
      }
    }

    try {
      const backupResult = await callOpenAI(prompt);

      return res.status(200).json({
        results: backupResult.results,
        provider: backupResult.provider
      });
    } catch (backupError) {
      console.error("Backup OpenAI error:", {
        message: backupError.message,
        status: backupError.status,
        raw: backupError.raw
      });

      return res.status(200).json({
        results: [],
        provider: "none",
        error: "Both providers failed"
      });
    }
  } catch (err) {
    console.error("search-ai fatal error:", err);

    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}
