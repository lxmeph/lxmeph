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
        error: "Не найден OPENROUTER_API_KEY в Render"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Фото не загружено"
      });
    }

    const base64Image = req.file.buffer.toString("base64");
    const mimeType = req.file.mimetype || "image/jpeg";

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

Не создавай ложную точность. Если порцию невозможно определить точно, оцени её приблизительно.

Верни ТОЛЬКО JSON, без markdown и без ```.

Формат:

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

confidence — число от 0 до 1.
`;

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
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
                    url: `data:${mimeType};base64,${base64Image}`
                  }
                }
              ]
            }
          ]
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: result?.error?.message || "Ошибка OpenRouter"
      });
    }

    let text = result?.choices?.[0]?.message?.content || "";

    text = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const data = JSON.parse(text);

    res.json(data);

  } catch (e) {
    console.error(e);

    res.status(500).json({
      error: e.message || "AI не смог обработать фото"
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
  console.log(`FoodLens running on port ${PORT}`);
});
