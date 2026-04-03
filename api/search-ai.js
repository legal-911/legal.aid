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

Нижче список кандидатів. Потрібно вибрати найбільш схожі статті саме за змістом ситуації, а не лише за окремими словами.

Правила:
- враховуй сенс ситуації
- віддавай перевагу конкретним статтям, а не занадто загальним
- можна вибрати від 1 до 10 найкращих результатів
- якщо стаття слабко підходить, краще не включати її
- поверни тільки JSON без пояснень поза JSON

Формат відповіді:
{
  "results": [
    { "index": 12, "score": 95, "reason": "коротка причина" },
    { "index": 7, "score": 88, "reason": "коротка причина" }
  ]
}

Кандидати:
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
  generationConfig: {
    temperature: 0.2,
    responseMimeType: "application/json"
  },
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
