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
        error: "OPENROUTER_API_KEY не найден"
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Фото не загружено"
      });
    }

    const image = req.file.buffer.toString("base64");
    const mime = req.file.mimetype || "image/jpeg";

    const requestBody = {
      model: "openrouter/free",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Проанализируй еду на фотографии. Верни только JSON с полями items и total. Для каждого продукта укажи name, grams, calories, protein_g, fat_g, carbs_g, confidence. В total укажи calories, protein_g, fat_g, carbs_g. Оцени приблизительно и не создавай ложную точность."
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
        error: result.error?.message || "Ошибка OpenRouter"
      });
    }

    let text = result.choices?.[0]?.message?.content || "";

    text = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const data = JSON.parse(text);

    res.json(data);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message || "Ошибка AI"
    });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("FoodLens running on port " + PORT);
});
