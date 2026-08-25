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
  connectionString: process.env.DATABASE
});

/* =========================
   СОЗДАНИЕ ТАБЛИЦ
========================= */

async function initDatabase() {
  try {

    await pool.query(`
      
      CREATE TABLE IF NOT EXISTS profiles (
        id SERIAL PRIMARY KEY,
        age INTEGER,
        sex VARCHAR(20),
        start_weight NUMERIC(5,1),
        current_weight NUMERIC(5,1),
        target_weight NUMERIC(5,1),
        height NUMERIC(5,1),
        activity NUMERIC(5,3),
        calorie_goal INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS meals (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        meal_date DATE NOT NULL,
        meal_time TIME,
        name TEXT NOT NULL,
        grams NUMERIC(7,1),
        calories NUMERIC(8,1),
        protein NUMERIC(7,1),
        fat NUMERIC(7,1),
        carbs NUMERIC(7,1),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS weight_history (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        weight_date DATE NOT NULL,
        weight NUMERIC(5,1) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(profile_id, weight_date)
      );

      CREATE TABLE IF NOT EXISTS goals (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        target_weight NUMERIC(5,1),
        calorie_goal INTEGER,
        start_date DATE,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

    `);

    console.log(
      "PostgreSQL connected"
    );

    console.log(
      "FoodLens database tables ready"
    );

  } catch (error) {

    console.error(
      "Database initialization error:",
      error
    );

  }
}

initDatabase();

/* =========================
   ЗАГРУЗКА ФОТО
========================= */

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

app.use(express.json());

/* =========================
   САЙТ
========================= */

app.use(
  express.static(__dirname)
);

app.get("/", (req, res) => {

  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );

});

/* =========================
   ПРОВЕРКА DATABASE
========================= */

app.get(
  "/api/db-test",
  async (req, res) => {

    try {

      const result =
        await pool.query(
          "SELECT NOW() AS time"
        );

      res.json({
        ok: true,
        database: "connected",
        time: result.rows[0].time
      });

    } catch (error) {

      console.error(
        "Database test error:",
        error
      );

      res.status(500).json({
        ok: false,
        error: error.message
      });

    }

  }
);

/* =========================
   AI-АНАЛИЗ ФОТО
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
          error:
            "Фото не загружено"
        });

      }

      const image =
        req.file.buffer.toString(
          "base64"
        );

      const mime =
        req.file.mimetype ||
        "image/jpeg";

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

        model:
          "openrouter/free",

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

      const response =
        await fetch(
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
              JSON.stringify(
                requestBody
              )

          }
        );

      const result =
        await response.json();

      if (!response.ok) {

        return res
          .status(response.status)
          .json({

            error:
              result
                ?.error
                ?.message ||
              "Ошибка OpenRouter"

          });

      }

      let text =
        result
          ?.choices?.[0]
          ?.message
          ?.content ||
        "";

      text =
        text.trim();

      /* Убираем markdown */

      if (
        text.startsWith("```")
      ) {

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

      /* Находим JSON */

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
   ПРОВЕРКА СЕРВЕРА
========================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true
    });

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
