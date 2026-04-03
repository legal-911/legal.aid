export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: "No query provided" });
    }

    const prompt = `
Ти допомагаєш юридичному сайту шукати статті законів України.
Користувач ввів запит: "${query}"

Поверни JSON-масив із 6-10 коротких варіантів пошуку українською мовою.
Додай:
- головну фразу
- юридичні синоніми
- близькі формулювання
- можливу назву права або процесуальної дії

Тільки JSON-масив рядків. Без пояснень.
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

    let terms = [];
    try {
      terms = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (match) {
        terms = JSON.parse(match[0]);
      }
    }

    if (!Array.isArray(terms) || terms.length === 0) {
      terms = [query];
    }

    return res.status(200).json({ terms });
  } catch (err) {
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}