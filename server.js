import "dotenv/config";
import express from "express";
import multer from "multer";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   POSTGRESQL
========================= */

const pool = new Pool({
  connectionString: process.env.DATABASE,
  ssl: {
    rejectUnauthorized: false
  }
});

/* =========================
   СОЗДАНИЕ ТАБЛИЦЫ
========================= */

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS weight_entries (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        date DATE NOT NULL,
        weight NUMERIC(6,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, date)
      );
    `);

    console.log("PostgreSQL connected");
    console.log("Database tables ready");

  } catch (error) {
    console.error("Database initialization error:", error);
  }
}

initDatabase();

/* =========================
   MULTER
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

/* =========================
   EXPRESS
========================= */

app.use(express.json());

app.use(express.static(__dirname));

/* =========================
   ГЛАВНАЯ
========================= */

app.get("/", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =========================
   HEALTH
========================= */

app.get("/api/health", async (req, res) => {

  try {

    await pool.query("SELECT NOW()");

    res.json({
      ok: true,
      database: true
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      ok: false,
      database: false,
      error: error.message
    });

  }

});

/* =========================
   СОХРАНИТЬ ВЕС
========================= */

app.post("/api/weight", async (req, res) => {

  try {

    const {
      userId,
      date,
      weight
    } = req.body;

    if (!userId) {

      return res.status(400).json({
        error: "userId не указан"
      });

    }

    if (!date) {

      return res.status(400).json({
        error: "date не указана"
      });

    }

    const numericWeight = Number(weight);

    if (
      !Number.isFinite(numericWeight) ||
      numericWeight <= 0 ||
      numericWeight > 500
    ) {

      return res.status(400).json({
        error: "Некорректный вес"
      });

    }

    const result = await pool.query(
      `
      INSERT INTO weight_entries
        (user_id, date, weight)
      VALUES
        ($1, $2, $3)
      ON CONFLICT (user_id, date)
      DO UPDATE SET
        weight = EXCLUDED.weight
      RETURNING
        id,
        user_id,
        date,
        weight
      `,
      [
        String(userId),
        date,
        numericWeight
      ]
    );

    res.json({
      ok: true,
      entry: result.rows[0]
    });

  } catch (error) {

    console.error(
      "Weight save error:",
      error
    );

    res.status(500).json({
      error:
        error.message ||
        "Ошибка сохранения веса"
    });

  }

});

/* =========================
   ПОЛУЧИТЬ ВЕС
========================= */

app.get("/api/weight", async (req, res) => {

  try {

    const userId =
      String(req.query.userId || "");

    if (!userId) {

      return res.status(400).json({
        error: "userId не указан"
      });

    }

    const result = await pool.query(
      `
      SELECT
        id,
        user_id,
        date,
        weight
      FROM weight_entries
      WHERE user_id = $1
      ORDER BY date ASC
      `,
      [userId]
    );

    res.json({
      ok: true,
      weights: result.rows
    });

  } catch (error) {

    console.error(
      "Weight load error:",
      error
    );

    res.status(500).json({
      error:
        error.message ||
        "Ошибка загрузки веса"
    });

  }

});

/* =========================
   AI АНАЛИЗ ФОТО
========================= */

app.post(
  "/api/analyze",
  upload.single("photo"),
  async (req, res) => {

    try {

      if (!process.env.OPENROUTER_API_KEY) {

        return res.status(500).json({
          error:
            "OPENROUTER_API_KEY не найден в Render"
        });

      }

      if (!req.file) {

        return res.status(400).json({
          error: "Фото не загружено"
        });

      }

      const image =
        req.file.buffer.toString("base64");

      const mime =
        req.file.mimetype || "image/jpeg";

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
                  url:
                    "data:" +
                    mime +
                    ";base64," +
                    image
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
            "Authorization":
              "Bearer " +
              process.env.OPENROUTER_API_KEY,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(requestBody)
        }
      );

      const result =
        await response.json();

      if (!response.ok) {

        return res.status(
          response.status
        ).json({

          error:
            result?.error?.message ||
            "Ошибка OpenRouter"

        });

      }

      let text =
        result?.choices?.[0]?.message?.content ||
        "";

      text = text.trim();

      if (text.startsWith("```")) {

        text =
          text.replace(
            /^```(?:json)?\s*/i,
            ""
          );

        text =
          text.replace(
            /\s*```\s*$/i,
            ""
          );

      }

      const firstBrace =
        text.indexOf("{");

      const lastBrace =
        text.lastIndexOf("}");

      if (
        firstBrace === -1 ||
        lastBrace === -1
      ) {

        throw new Error(
          "AI не вернул JSON"
        );

      }

      text =
        text.slice(
          firstBrace,
          lastBrace + 1
        );

      const data =
        JSON.parse(text);

      res.json(data);

    } catch (error) {

      console.error(
        "FoodLens error:",
        error
      );

      res.status(500).json({

        error:
          error.message ||
          "AI не смог обработать фото"

      });

    }

  }
);

/* =========================
   ЗАПУСК
========================= */

const PORT =
  process.env.PORT || 3000;

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "FoodLens running on port " +
      PORT
    );

  }
);
