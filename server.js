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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      id SERIAL PRIMARY KEY,
      age INTEGER,
      sex TEXT,
      start_weight NUMERIC(6,2),
      current_weight NUMERIC(6,2),
      target_weight NUMERIC(6,2),
      height NUMERIC(6,2),
      activity NUMERIC(5,3),
      calorie_goal INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

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
      meal_time TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS weights (
      id SERIAL PRIMARY KEY,
      profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
      weight_date DATE NOT NULL,
      weight NUMERIC(6,2) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(profile_id, weight_date)
    );
  `);

  console.log("PostgreSQL tables ready");
}

initDatabase()
  .then(() => {
    console.log("PostgreSQL connected");
  })
  .catch((error) => {
    console.error("PostgreSQL initialization error:", error);
  });

/* =========================
   PROFILE
========================= */

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
    console.error(error);

    res.status(500).json({
      error: "Не удалось загрузить профиль"
    });
  }
});

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

    if (
      !age ||
      !startWeight ||
      !targetWeight ||
      !height ||
      !activity
    ) {
      return res.status(400).json({
        error: "Заполни все данные профиля"
      });
    }

    const existing = await pool.query(`
      SELECT id
      FROM profiles
      ORDER BY id ASC
      LIMIT 1
    `);

    let result;

    if (existing.rows.length === 0) {

      result = await pool.query(`
        INSERT INTO profiles
        (
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
        calorieGoal || 0
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
        currentWeight || startWeight,
        targetWeight,
        height,
        activity,
        calorieGoal || 0,
        existing.rows[0].id
      ]);
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка сохранения профиля"
    });
  }
});

/* =========================
   MEALS
========================= */

app.get("/api/meals", async (req, res) => {
  try {
    const date = req.query.date;

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
      SELECT *
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
    console.error(error);

    res.status(500).json({
      error: "Не удалось загрузить еду"
    });
  }
});

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
      INSERT INTO meals
      (
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
      date,
      name,
      grams || 0,
      calories || 0,
      protein || 0,
      fat || 0,
      carbs || 0,
      time || ""
    ]);

    res.json(result.rows[0]);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка сохранения еды"
    });
  }
});

app.delete("/api/meals/:id", async (req, res) => {
  try {
    await pool.query(`
      DELETE FROM meals
      WHERE id = $1
    `, [req.params.id]);

    res.json({
      ok: true
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка удаления еды"
    });
  }
});

/* =========================
   WEIGHTS
========================= */

app.get("/api/weights", async (req, res) => {
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
      SELECT *
      FROM weights
      WHERE profile_id = $1
      ORDER BY weight_date ASC
    `, [profile.rows[0].id]);

    res.json(result.rows);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Не удалось загрузить историю веса"
    });
  }
});

app.post("/api/weights", async (req, res) => {
  try {
    const {
      date,
      weight
    } = req.body;

    if (!date || !weight || Number(weight) <= 0) {
      return res.status(400).json({
        error: "Некорректный вес"
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
      INSERT INTO weights
      (
        profile_id,
        weight_date,
        weight
      )
      VALUES ($1,$2,$3)
      ON CONFLICT (profile_id, weight_date)
      DO UPDATE SET weight = EXCLUDED.weight
      RETURNING *
    `, [
      profileId,
      date,
      Number(weight)
    ]);

    await pool.query(`
      UPDATE profiles
      SET current_weight = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [
      Number(weight),
      profileId
    ]);

    res.json(result.rows[0]);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка сохранения веса"
    });
  }
});

/* =========================
   AI ANALYSIS
========================= */

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

Верни ТОЛЬКО JSON:

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

confidence от 0 до 1.

Не используй markdown.
Не используй тройные обратные кавычки.
Не добавляй слова до или после JSON.
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
      return res.status(response.status).json({
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
      text = text.replace(
        /^```(?:json)?\s*/i,
        ""
      );

      text = text.replace(
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
});

/* =========================
   HEALTH
========================= */

app.get("/api/health", async (req, res) => {
  try {

    await pool.query(
      "SELECT NOW()"
    );

    res.json({
      ok: true,
      database: true
    });

  } catch (error) {

    res.status(500).json({
      ok: false,
      database: false
    });

  }
});

/* =========================
   STATIC
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
   START
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
