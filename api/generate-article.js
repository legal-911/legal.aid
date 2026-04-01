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

Твоя задача — перетворити текст закону у чітко структурований формат без зміни змісту.

ВАЖЛИВО:
- НЕ змінюй юридичний зміст
- НЕ перефразовуй норму закону
- ІГНОРУЙ службові вставки у фігурних дужках { ... }
- Зберігай структуру статті
- Розбивай текст на абзаци для читабельності
- Якщо в тексті є явно важливі моменти, позначай їх як **ВАЖЛИВО**
- Якщо в тексті є винятки, позначай їх як *ВИКЛЮЧЕННЯ*
- Не вигадуй нічого від себе
- Не додавай пояснень поза текстом статті
- Не використовуй скорочену назву закону, пиши повну назву

ПОВЕРТАЙ РЕЗУЛЬТАТ СТРОГО У JSON ФОРМАТІ:
{
  "law": "Стаття X ${section}",
  "short": "Короткий опис",
  "details": "*Назва статті*\\n\\nТекст статті...",
  "link": "${link || ""}"
}

Ось текст статті:
${rawText}

Повна назва закону:
${section}
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "Ти юридичний форматувальник тексту."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.log("OPENAI HTTP ERROR:", data);
      return res.status(500).json({
        error: "OpenAI API error",
        details: data
      });
    }

    if (!data.choices || !data.choices[0]?.message?.content) {
      console.log("OPENAI ERROR:", data);
      return res.status(500).json({
        error: "OpenAI не повернув choices",
        details: data
      });
    }

    const content = data.choices[0].message.content;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.log("INVALID JSON FROM MODEL:", content);
      return res.status(500).json({
        error: "Модель повернула не JSON",
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
