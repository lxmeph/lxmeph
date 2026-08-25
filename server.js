import "dotenv/config";
import express from "express";
import multer from "multer";
import OpenAI from "openai";

const app = express();
const upload = multer({storage: multer.memoryStorage(), limits:{fileSize: 8*1024*1024}});
const client = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
app.use(express.static("."));
app.use(express.json());

app.post("/api/analyze", upload.single("photo"), async (req,res)=>{
  try{
    if(!process.env.OPENAI_API_KEY) return res.status(500).json({error:"Не найден OPENAI_API_KEY в .env"});
    if(!req.file) return res.status(400).json({error:"Фото не загружено"});
    const b64=req.file.buffer.toString("base64");
    const mime=req.file.mimetype||"image/jpeg";
    const r=await client.responses.create({
      model:"gpt-5.6-luna",
      input:[{role:"user",content:[
        {type:"input_text",text:`Ты AI-ассистент приложения FoodLens. Анализируй ТОЛЬКО то, что видно на фото.
Оцени продукты и порции приблизительно. Не создавай ложную точность.
Верни ТОЛЬКО JSON следующего вида:
{"items":[{"name":"название","grams":0,"calories":0,"protein_g":0,"fat_g":0,"carbs_g":0,"confidence":0.0}],"total":{"calories":0,"protein_g":0,"fat_g":0,"carbs_g":0},"note":"краткая оговорка об оценке"}
confidence от 0 до 1.`},
        {type:"input_image",image_url:`data:${mime};base64,${b64}`}
      ]}]
    });
    const cleaned=r.output_text.replace(/^```json\s*/,"").replace(/```$/,"").trim();
    res.json(JSON.parse(cleaned));
  }catch(e){
    console.error(e);
    res.status(500).json({error:"AI не смог обработать фото",detail:e.message});
  }
});
app.get("/api/health",(req,res)=>res.json({ok:true}));
app.listen(process.env.PORT||3000,()=>console.log(`FoodLens: http://localhost:${process.env.PORT||3000}`));
