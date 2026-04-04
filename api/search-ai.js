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

Користувач описав ситуацію:
"${query}"

Нижче список кандидатів.

Кожен кандидат має поля:
- law → назва статті (ВАЖЛИВО)
- short → короткий опис (ДУЖЕ ВАЖЛИВО)
- details → повний текст (НАЙВАЖЛИВІШЕ)
- section → назва закону

ТВОЄ ЗАВДАННЯ:
знайти найбільш підходящі статті за змістом ситуації.

ПРАВИЛА:
- details має найбільшу вагу
- short теж дуже важливий
- law важливий (особливо якщо є номер статті)
- section допоміжний

- враховуй сенс, а не тільки слова
- якщо є точне попадання по змісту → став дуже високий score
- якщо часткове → середній
- якщо слабке → не додавай

- максимум 10 результатів
- мінімум 1 якщо є хоча б щось схоже

ФОРМАТ:
поверни тільки JSON:

{
  "results": [
    { "index": 12, "score": 95, "reason": "коротко чому підходить" }
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

let results = Array.isArray(parsed.results) ? parsed.results : [];

// убираем мусор
results = results
  .filter(r => r.score >= 40)
  .slice(0, 10);
  
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}
