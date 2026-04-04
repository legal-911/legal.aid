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
7. Якщо є стаття, яка прямо описує правовий статус, імунітет, недоторканність, право, обов’язок або заборону у ситуації користувача — піднімай її вище.
8. score від 0 до 100:
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

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
   headers: {
  "Content-Type": "application/json; charset=utf-8",
  "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
  "HTTP-Referer": "https://legal-aid-d4cg.vercel.app",
  "X-Title": "Юридична допомога"
},
      body: JSON.stringify({
  model: "openrouter/auto",
  messages: [
    {
      role: "user",
      content: prompt
    }
  ],
  temperature: 0.2
      })
}); 

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "OpenRouter API error"
      });
    }

    const text = data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      return res.status(500).json({
        error: "OpenRouter returned empty text",
        raw: data
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "OpenRouter returned invalid JSON",
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
