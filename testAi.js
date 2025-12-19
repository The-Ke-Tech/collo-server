const { GoogleGenAI } = require("@google/genai");
require("dotenv").config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Robust extractor with debug logging
function extractAiText(resp) {
  if (!resp) return "No response";

  console.log("🔹 Full AI Response:", JSON.stringify(resp, null, 2));

  try {
    if (resp.candidates && resp.candidates.length > 0) {
      const candidate = resp.candidates[0];
      const content = candidate.content;

      // Handle both object (new) and array (old) forms
      if (content) {
        if (Array.isArray(content)) {
          const texts = content
            .filter(p => typeof p.text === "string")
            .map(p => p.text);
          if (texts.length > 0) return texts.join("\n");
        } else if (typeof content === "object" && Array.isArray(content.parts)) {
          const texts = content.parts
            .filter(p => typeof p.text === "string")
            .map(p => p.text);
          if (texts.length > 0) return texts.join("\n");
        }
      }
    }

    if (resp.output && Array.isArray(resp.output) && resp.output[0]?.text) {
      return resp.output[0].text;
    }

    return "No response";
  } catch (err) {
    console.error("Extractor error:", err);
    return "No response";
  }
}


async function handleAiMessage(userMessage, context = "") {
  try {
    const resp = await ai.models.generateContent({
      model: "gemini-robotics-er-1.5-preview",
      contents: [
        {
          role: "user",
          parts: [{ text: `${context}\n\nUser: ${userMessage}` }],
        },
      ],
    });

    return extractAiText(resp);
  } catch (err) {
    console.error("AI error:", err);
    return "AI unavailable. Contact support at +254 758 982 859";
  }
}

(async () => {
  const userMessage = "Tell me about KCSE admission requirements";
  const context = "You are 'Right Path Schools Assistant'. Provide concise, actionable answers about KCSE admissions.";

  const reply = await handleAiMessage(userMessage, context);
  console.log("AI replied:", reply);
})();
