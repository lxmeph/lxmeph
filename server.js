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

if (!process.env.DATABASE) {
  console.error("DATABASE не найден в Environment Variables");
}

const pool = new Pool({
  connectionString: process.env.DATABASE,
  ssl: {
    rejectUnauthorized: false
  }
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
        start_weight NUMERIC(6,2),
        current_weight NUMERIC(6,2),
        target_weight NUMERIC(6,2),
        height NUMERIC(6,2),
        activity NUMERIC(6,3),
        calorie_goal INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meals (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        meal_date DATE NOT NULL,
        name TEXT NOT NULL,
        grams NUMERIC(8,2) DEFAULT 0,
        calories NUMERIC(10,2) DEFAULT 0,
        protein NUMERIC(10,2) DEFAULT 0,
        fat NUMERIC(10,2) DEFAULT 0,
        carbs NUMERIC(10,2) DEFAULT 0,
        meal_time VARCHAR(10),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS weight_history (
        id SERIAL PRIMARY KEY,
        profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
        weight_date DATE NOT NULL,
        weight NUMERIC(6,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS meals_profile_date_idx
      ON meals(profile_id, meal_date);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS weight_profile_date_idx
      ON weight_history(profile_id, weight_date);
    `);

    console.log("PostgreSQL tables ready");

  } catch (error) {
    console.error("Database initialization error:", error);
  }
}

/* =========================
   MIDDLEWARE
========================= */

app.use(express.json());

app.use(express.static(__dirname));

/* =========================
   ГЛАВНАЯ
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================
   ПРОФИЛЬ
========================= */

/*
  Получить профиль.
  Пока используем первый профиль пользователя.
*/

app.get("/api/profile", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM profiles
      ORDER BY id ASC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return res.json(null);
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Get profile error:", error);

    res.status(500).json({
      error: "Ошибка загрузки профиля"
    });
  }
});


/*
  Создать или обновить профиль.
*/

app.post("/api/profile", async (req, res) => {
  try {

    const {
      age,
      sex,
      startWeight,
      currentWeight,
      targetWeight,
      height,
      activity,
      calorieGoal
    } = req.body;

    const existing = await pool.query(`
      SELECT id
      FROM profiles
      ORDER BY id ASC
      LIMIT 1
    `);

    let result;

    if (existing.rows.length === 0) {

      result = await pool.query(`
        INSERT INTO profiles (
          age,
          sex,
          start_weight,
          current_weight,
          target_weight,
          height,
          activity,
          calorie_goal
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `, [
        age,
        sex,
        startWeight,
        currentWeight || startWeight,
        targetWeight,
        height,
        activity,
        calorieGoal
      ]);

    } else {

      result = await pool.query(`
        UPDATE profiles
        SET
          age = $1,
          sex = $2,
          start_weight = $3,
          current_weight = $4,
          target_weight = $5,
          height = $6,
          activity = $7,
          calorie_goal = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
        RETURNING *
      `, [
        age,
        sex,
        startWeight,
        currentWeight,
        targetWeight,
        height,
        activity,
        calorieGoal,
        existing.rows[0].id
      ]);

    }

    res.json(result.rows[0]);

  } catch (error) {

    console.error("Save profile error:", error);

    res.status(500).json({
      error: "Ошибка сохранения профиля"
    });

  }
});

/* =========================
   ВЕС
========================= */

/*
  Получить историю веса.
*/

app.get("/api/weight", async (req, res) => {

  try {

    const profile = await pool.query(`
      SELECT id
      FROM profiles
      ORDER BY id ASC
      LIMIT 1
    `);

    if (profile.rows.length === 0) {
      return res.json([]);
    }

    const result = await pool.query(`
      SELECT
        weight_date AS date,
        weight
      FROM weight_history
      WHERE profile_id = $1
      ORDER BY weight_date ASC
    `, [
      profile.rows[0].id
    ]);

    res.json(result.rows);

  } catch (error) {

    console.error("Get weight error:", error);

    res.status(500).json({
      error: "Ошибка загрузки веса"
    });

  }

});


/*
  Сохранить вес.
*/

app.post("/api/weight", async (req, res) => {

  try {

    const {
      date,
      weight
    } = req.body;

    if (!date || !Number.isFinite(Number(weight))) {

      return res.status(400).json({
        error: "Некорректные данные веса"
      });

    }

    const profile = await pool.query(`
      SELECT id
      FROM profiles
      ORDER BY id ASC
      LIMIT 1
    `);

    if (profile.rows.length === 0) {

      return res.status(400).json({
        error: "Сначала создай профиль"
      });

    }

    const profileId = profile.rows[0].id;

    const result = await pool.query(`
      INSERT INTO weight_history (
        profile_id,
        weight_date,
        weight
      )
      VALUES ($1,$2,$3)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [
      profileId,
      date,
      Number(weight)
    ]);

    /*
      Если запись за этот день уже существует,
      обновляем её.
    */

    if (result.rows.length === 0) {

      const updated = await pool.query(`
        UPDATE weight_history
        SET weight = $1
        WHERE profile_id = $2
        AND weight_date = $3
        RETURNING *
      `, [
        Number(weight),
        profileId,
        date
      ]);

      return res.json(updated.rows[0]);
    }

    /*
      Обновляем текущий вес профиля.
    */

    await pool.query(`
      UPDATE profiles
      SET
        current_weight = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [
      Number(weight),
      profileId
    ]);

    res.json(result.rows[0]);

  } catch (error) {

    console.error("Save weight error:", error);

    res.status(500).json({
      error: "Ошибка сохранения веса"
    });

  }

});


/* =========================
   ЕДА
========================= */

/*
  Получить блюда за конкретный день.
*/

app.get("/api/meals", async (req, res) => {

  try {

    const date =
      req.query.date ||
      new Date().toISOString().slice(0, 10);

    const profile = await pool.query(`
      SELECT id
      FROM profiles
      ORDER BY id ASC
      LIMIT 1
    `);

    if (profile.rows.length === 0) {
      return res.json([]);
    }

    const result = await pool.query(`
      SELECT
        id,
        meal_date,
        name,
        grams,
        calories,
        protein,
        fat,
        carbs,
        meal_time
      FROM meals
      WHERE profile_id = $1
      AND meal_date = $2
      ORDER BY id ASC
    `, [
      profile.rows[0].id,
      date
    ]);

    res.json(result.rows);

  } catch (error) {

    console.error("Get meals error:", error);

    res.status(500).json({
      error: "Ошибка загрузки еды"
    });

  }

});


/*
  Добавить блюдо.
*/

app.post("/api/meals", async (req, res) => {

  try {

    const {
      date,
      name,
      grams,
      calories,
      protein,
      fat,
      carbs,
      time
    } = req.body;

    if (!name) {

      return res.status(400).json({
        error: "Название блюда обязательно"
      });

    }

    const profile = await pool.query(`
      SELECT id
      FROM profiles
      ORDER BY id ASC
      LIMIT 1
    `);

    if (profile.rows.length === 0) {

      return res.status(400).json({
        error: "Сначала создай профиль"
      });

    }

    const result = await pool.query(`
      INSERT INTO meals (
        profile_id,
        meal_date,
        name,
        grams,
        calories,
        protein,
        fat,
        carbs,
        meal_time
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      profile.rows[0].id,
      date || new Date().toISOString().slice(0, 10),
      name,
      Number(grams) || 0,
      Number(calories) || 0,
      Number(protein) || 0,
      Number(fat) || 0,
      Number(carbs) || 0,
      time || ""
    ]);

    res.json(result.rows[0]);

  } catch (error) {

    console.error("Save meal error:", error);

    res.status(500).json({
      error: "Ошибка сохранения блюда"
    });

  }

});


/*
  Удалить блюдо.
*/

app.delete("/api/meals/:id", async (req, res) => {

  try {

    await pool.query(`
      DELETE FROM meals
      WHERE id = $1
    `, [
      req.params.id
    ]);

    res.json({
      ok: true
    });

  } catch (error) {

    console.error("Delete meal error:", error);

    res.status(500).json({
      error: "Ошибка удаления блюда"
    });

  }

});


/* =========================
   AI FOOD ANALYSIS
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

app.post(
  "/api/analyze",
  upload.single("photo"),
  async (req, res) => {

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

        return res
          .status(response.status)
          .json({
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
        "FoodLens AI error:",
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
   HEALTH CHECK
========================= */

app.get("/api/health", async (req, res) => {

  try {

    await pool.query("SELECT NOW()");

    res.json({
      ok: true,
      database: true
    });

  } catch (error) {

    res.status(500).json({
      ok: false,
      database: false,
      error: error.message
    });

  }

});


/* =========================
   ЗАПУСК
========================= */

const PORT =
  process.env.PORT || 3000;

async function startServer() {

  await initDatabase();

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

}

startServer();
