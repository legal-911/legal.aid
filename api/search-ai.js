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
7. score від 0 до 100:
   - 90-100: майже точне попадання по ситуації
   - 70-89: сильна релевантність
   - 50-69: часткова, але корисна релевантність
   - нижче 50: слабка релевантність

Поверни тільки JSON без будь-якого іншого тексту.

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

results = results
  .filter(item => typeof item.index === "number")
  .filter(item => typeof item.score === "number")
  .filter(item => item.score >= 45)
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);

return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}
