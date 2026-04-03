export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { query, candidates } = req.body;

    if (!query || !Array.isArray(candidates) || candidates.length === 0) {
      return res.status(400).json({ error: "No query or candidates" });
    }

    const compactCandidates = candidates.map(item => ({
      index: item.originalIndex,
      law: item.law || "",
      section: item.section || "",
      short: item.short || "",
      details: (item.details || "").slice(0, 1800)
    }));

    const prompt = `
Ти допомагаєш юридичному сайту України знаходити найбільш релевантні статті закону.

Користувач описав ситуацію простою мовою:
"${query}"

Нижче список статей. Для кожної статті оціни, наскільки вона підходить до ситуації користувача.

Правила:
- орієнтуйся на сенс, а не тільки на окремі слова
- зверху мають бути статті, які найбільш точно підходять до опису ситуації
- якщо стаття майже не підходить, можна дати низький бал
- score від 0 до 100
- поверни тільки JSON

Формат:
{
  "results": [
    { "index": 1, "score": 98, "reason": "дуже близько за змістом" },
    { "index": 7, "score": 90, "reason": "регулює схожу ситуацію" },
    { "index": 3, "score": 40, "reason": "лише частково підходить" }
  ]
}

Статті:
${JSON.stringify(compactCandidates, null, 2)}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Gemini API error",
        details: data
      });
    }

    const parts = data.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || "").join("").trim();

    if (!text) {
      return res.status(500).json({
        error: "Gemini returned empty text",
        raw: data
      });
    }

    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(500).json({
        error: "Gemini returned invalid JSON",
        raw: text
      });
    }

    const results = Array.isArray(parsed.results) ? parsed.results : [];
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}
