import "dotenv/config";
import express from "express";
import multer from "multer";

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

app.use(express.static("."));
app.use(express.json());

app.post("/api/analyze", upload.single("photo"), async (req, res) => {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(500).json({
        error: "OPENROUTER_API_KEY не найден в Render"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Фото не загружено"
      });
    }

    const image = req.file.buffer.toString("base64");
    const mime = req.file.mimetype || "image/jpeg";

    const prompt = `
Ты AI-ассистент приложения FoodLens.

Проанализируй еду на фотографии.

Определи приблизительно:
- название каждого продукта или блюда;
- примерный вес в граммах;
- калории;
- белки;
- жиры;
- углеводы.

Не создавай ложную точность.

Верни ТОЛЬКО JSON следующего вида:

{
  "items": [
    {
      "name": "название",
      "grams": 0,
      "calories": 0,
      "protein_g": 0,
      "fat_g": 0,
      "carbs_g": 0,
      "confidence": 0.0
    }
  ],
  "total": {
    "calories": 0,
    "protein_g": 0,
    "fat_g": 0,
    "carbs_g": 0
  },
  "note": "краткая оговорка об оценке"
}

confidence должен быть числом от 0 до 1.

Не используй markdown.
Не используй тройные обратные кавычки.
Не добавляй никаких слов до или после JSON.
`;

    const requestBody = {
      model: "openrouter/free",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: prompt
            },
            {
              type: "image_url",
              image_url: {
                url: "data:" + mime + ";base64," + image
              }
            }
          ]
        }
      ]
    };

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + process.env.OPENROUTER_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: result?.error?.message || "Ошибка OpenRouter"
      });
    }

    let text = result?.choices?.[0]?.message?.content || "";

    text = text.trim();

    // Убираем markdown, если AI всё-таки его добавил
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/i, "");
      text = text.replace(/\s*```\s*$/i, "");
    }

    // Иногда модель добавляет лишний текст вокруг JSON.
    // Берём только содержимое от первой { до последней }.
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1) {
      throw new Error("AI не вернул JSON");
    }

    text = text.slice(firstBrace, lastBrace + 1);

    const data = JSON.parse(text);

    res.json(data);

  } catch (error) {
    console.error("FoodLens error:", error);

    res.status(500).json({
      error: error.message || "AI не смог обработать фото"
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("FoodLens running on port " + PORT);
});
