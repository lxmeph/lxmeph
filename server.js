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
   UPLOAD
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024
  }
});

app.use(express.json());

/* =========================
   DATABASE INIT
========================= */

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        age INTEGER,
        sex VARCHAR(20),
        start_weight NUMERIC(6,2),
        current_weight NUMERIC(6,2),
        target_weight NUMERIC(6,2),
        height NUMERIC(6,2),
        activity NUMERIC(5,3),
        calorie_goal INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        weight_date DATE NOT NULL,
        weight NUMERIC(6,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, weight_date)
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
   STATIC FILES
========================= */

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* =========================
   USER
========================= */

app.post("/api/user", async (req, res) => {
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

    const result = await pool.query(
      `
      INSERT INTO users (
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
      `,
      [
        age,
        sex,
        startWeight,
        currentWeight,
        targetWeight,
        height,
        activity,
        calorieGoal
      ]
    );

    res.json({
      ok: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Create user error:", error);

    res.status(500).json({
      error: "Не удалось сохранить профиль"
    });
  }
});

/* =========================
   GET USER
========================= */

app.get("/api/user/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE id = $1
      `,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Пользователь не найден"
      });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Get user error:", error);

    res.status(500).json({
      error: "Ошибка получения пользователя"
    });
  }
});

/* =========================
   UPDATE USER
========================= */

app.put("/api/user/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

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

    const result = await pool.query(
      `
      UPDATE users
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
      `,
      [
        age,
        sex,
        startWeight,
        currentWeight,
        targetWeight,
        height,
        activity,
        calorieGoal,
        id
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Пользователь не найден"
      });
    }

    res.json({
      ok: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Update user error:", error);

    res.status(500).json({
      error: "Не удалось обновить профиль"
    });
  }
});

/* =========================
   ADD MEAL
========================= */

app.post("/api/meals", async (req, res) => {
  try {
    const {
      userId,
      date,
      name,
      grams,
      calories,
      protein,
      fat,
      carbs,
      time
    } = req.body;

    if (!userId || !name) {
      return res.status(400).json({
        error: "Не хватает данных"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO meals (
        user_id,
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
      `,
      [
        userId,
        date,
        name,
        grams || 0,
        calories || 0,
        protein || 0,
        fat || 0,
        carbs || 0,
        time || null
      ]
    );

    res.json({
      ok: true,
      meal: result.rows[0]
    });

  } catch (error) {
    console.error("Add meal error:", error);

    res.status(500).json({
      error: "Не удалось сохранить блюдо"
    });
  }
});

/* =========================
   GET MEALS
========================= */

app.get("/api/meals/:userId/:date", async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const date = req.params.date;

    const result = await pool.query(
      `
      SELECT *
      FROM meals
      WHERE user_id = $1
      AND meal_date = $2
      ORDER BY created_at ASC
      `,
      [userId, date]
    );

    res.json({
      meals: result.rows
    });

  } catch (error) {
    console.error("Get meals error:", error);

    res.status(500).json({
      error: "Не удалось получить блюда"
    });
  }
});

/* =========================
   DELETE MEAL
========================= */

app.delete("/api/meals/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    await pool.query(
      `
      DELETE FROM meals
      WHERE id = $1
      `,
      [id]
    );

    res.json({
      ok: true
    });

  } catch (error) {
    console.error("Delete meal error:", error);

    res.status(500).json({
      error: "Не удалось удалить блюдо"
    });
  }
});

/* =========================
   WEIGHT
========================= */

app.post("/api/weight", async (req, res) => {
  try {
    const {
      userId,
      date,
      weight
    } = req.body;

    if (!userId || !date || !weight) {
      return res.status(400).json({
        error: "Не хватает данных"
      });
    }

    const result = await pool.query(
      `
      INSERT INTO weight_history (
        user_id,
        weight_date,
        weight
      )
      VALUES ($1,$2,$3)
      ON CONFLICT (user_id, weight_date)
      DO UPDATE SET
        weight = EXCLUDED.weight
      RETURNING *
      `,
      [
        userId,
        date,
        weight
      ]
    );

    await pool.query(
      `
      UPDATE users
      SET
        current_weight = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [
        weight,
        userId
      ]
    );

    res.json({
      ok: true,
      weight: result.rows[0]
    });

  } catch (error) {
    console.error("Save weight error:", error);

    res.status(500).json({
      error: "Не удалось сохранить вес"
    });
  }
});

/* =========================
   GET WEIGHT HISTORY
========================= */

app.get("/api/weight/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const result = await pool.query(
      `
      SELECT
        weight_date AS date,
        weight
      FROM weight_history
      WHERE user_id = $1
      ORDER BY weight_date ASC
      `,
      [userId]
    );

    res.json({
      weights: result.rows
    });

  } catch (error) {
    console.error("Get weight history error:", error);

    res.status(500).json({
      error: "Не удалось получить историю веса"
    });
  }
});

/* =========================
   HISTORY
========================= */

app.get("/api/history/:userId", async (req, res) => {
  try {
    const userId = Number(req.params.userId);

    const result = await pool.query(
      `
      SELECT
        meal_date AS date,
        COUNT(*) AS meals,
        COALESCE(SUM(calories),0) AS calories,
        COALESCE(SUM(protein),0) AS protein,
        COALESCE(SUM(fat),0) AS fat,
        COALESCE(SUM(carbs),0) AS carbs
      FROM meals
      WHERE user_id = $1
      GROUP BY meal_date
      ORDER BY meal_date DESC
      `,
      [userId]
    );

    res.json({
      history: result.rows
    });

  } catch (error) {
    console.error("History error:", error);

    res.status(500).json({
      error: "Не удалось получить историю"
    });
  }
});

/* =========================
   AI FOOD ANALYSIS
========================= */

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

      text=text.trim();

      if(text.startsWith("```")){

        text=text.replace(
          /^```(?:json)?\s*/i,
          ""
        );

        text=text.replace(
          /\s*```\s*$/i,
          ""
        );

      }

      const firstBrace =
        text.indexOf("{");

      const lastBrace =
        text.lastIndexOf("}");

      if(
        firstBrace===-1 ||
        lastBrace===-1
      ){

        throw new Error(
          "AI не вернул JSON"
        );

      }

      text=
        text.slice(
          firstBrace,
          lastBrace+1
        );

      const data=
        JSON.parse(text);

      res.json(data);

    } catch(error){

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

    const result =
      await pool.query(
        "SELECT NOW()"
      );

    res.json({
      ok:true,
      database:true,
      time:result.rows[0].now
    });

  } catch(error){

    res.status(500).json({
      ok:false,
      database:false,
      error:error.message
    });

  }

});

/* =========================
   SERVER
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
