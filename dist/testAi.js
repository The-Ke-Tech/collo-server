"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const genai_1 = require("@google/genai");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
async function testAi() {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        console.error("⚠️ GEMINI_API_KEY not set in .env");
        return;
    }
    const ai = new genai_1.GoogleGenAI({ apiKey: GEMINI_API_KEY });
    async function extractAiText(resp) {
        try {
            if (!resp)
                return "";
            if (resp?.candidates?.[0]?.content?.[0]?.text)
                return resp.candidates[0].content[0].text;
            return JSON.stringify(resp).slice(0, 2000);
        }
        catch {
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
    }
    catch (err) {
        console.error("❌ AI call failed:", err);
    }
}
testAi();
