import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function testAi() {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    console.error("⚠️ GEMINI_API_KEY not set in .env");
    return;
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  async function extractAiText(resp: any): Promise<string> {
    try {
      if (!resp) return "";
      if (resp?.candidates?.[0]?.content?.[0]?.text)
        return resp.candidates[0].content[0].text;
      return JSON.stringify(resp).slice(0, 2000);
    } catch {
      return "Unable to extract AI reply.";
    }
  }

  const userMessage = "Tell me about KCSE admission requirements";
  const context = "You are 'Right Path Schools Assistant' giving concise answers.";

  try {
    const resp = await ai.models.generateContent({
      model: "learnlm-2.0-flash-experimental",
      contents: [
        {
          role: "user",
          parts: [{ text: `${context}\n\nUser: ${userMessage}` }],
        },
      ],
    });

    const aiText = await extractAiText(resp);
    console.log("💬 AI reply:", aiText);
  } catch (err) {
    console.error("❌ AI call failed:", err);
  }
}

testAi();
