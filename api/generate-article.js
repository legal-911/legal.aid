export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { section, rawText, link } = req.body;

    if (!section || !rawText) {
      return res.status(400).json({
        error: "Не вистачає section або rawText"
      });
    }

    const prompt = `
Ти форматувальник юридичних статей для сайту.

Твоя задача — перетворити текст закону у чітко структурований формат.

❗ ВАЖЛИВО:
- НЕ змінюй зміст закону
- ІГНОРУЙ службові вставки типу { ... }
- Зберігай структуру статті
- Додавай абзаци для читабельності
- Виділяй важливі моменти
- Не вигадуй нічого від себе

📌 ФОРМАТ ВИХОДУ (СТРОГО JSON):
{
  "law": "Стаття X ${section}",
  "short": "Назва статті",
  "details": "*Назва статті*\\n\\nТекст статті",
  "link": "${link || ""}"
}

📌 ПРАВИЛА:
- *жирний* означає жирний
- **курсив** означає курсив
- не додавай зайвих коментарів
- поверни тільки JSON

ТЕКСТ СТАТТІ:
${rawText}
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
              parts: [
                { text: prompt }
              ]
            }
          ]
        })
      }
    );

    const data = await response.json();

const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

if (!content) {
  console.log("BAD GEMINI RESPONSE:", data);
  return res.status(500).json({
    error: "Gemini не повернув текст",
    details: data
  });
}

// пробуємо знайти JSON навіть якщо Gemini обгорнув його в ```json
const cleaned = content
  .replace(/^```json\s*/i, "")
  .replace(/^```\s*/i, "")
  .replace(/\s*```$/i, "")
  .trim();

let parsed;
try {
  parsed = JSON.parse(cleaned);
} catch (e) {
  console.log("INVALID JSON FROM GEMINI:", content);
  return res.status(500).json({
    error: "Gemini повернув не JSON",
    raw: content
  });
}

return res.status(200).json(parsed);

  } catch (err) {
    console.log("SERVER ERROR:", err);
    return res.status(500).json({
      error: err.message || "Server error"
    });
  }
}
