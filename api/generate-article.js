export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text, lawName, link } = req.body;

    const prompt = `
Ти форматувальник юридичних статей для сайту.

Твоя задача — перетворити текст закону у чітко структурований формат.

❗ ВАЖЛИВО:
- НЕ змінюй зміст закону
- ІГНОРУЙ службові вставки типу { ... }
- Зберігай структуру статті
- Додавай абзаци для читабельності
- Виділяй важливі моменти

---

📌 ФОРМАТ ВИХОДУ:

Стаття X ${lawName}

Короткий опис

*Назва статті*

Текст статті

**ВАЖЛИВО**
...

*ВИКЛЮЧЕННЯ*
...

${link}

---

ТЕКСТ:
${text}
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await response.json();

    return res.status(200).json({
      result: data.choices[0].message.content,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}