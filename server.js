import "dotenv/config";
import express from "express";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY
});

app.use(express.static("."));
app.use(express.json());

app.post("/api/analyze", upload.single("photo"), async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Не найден GEMINI_API_KEY в Render"
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

Проанализируй ТОЛЬКО еду, которую видно на фотографии.

Определи приблизительно:
- какие продукты или блюда видны;
- примерный вес каждого продукта в граммах;
- калории;
- белки;
- жиры;
- углеводы.

Не создавай ложную точность.
Если вес невозможно определить точно, оцени приблизительно.

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

confidence должен быть числом от 0 до 1.
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Image
          }
        },
        {
          text: prompt
        }
      ]
    });

    let text = response.text || "";

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
      error: e.message || "Gemini не смог обработать фото"
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FoodLens running on port ${PORT}`);
});
