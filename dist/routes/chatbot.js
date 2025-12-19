"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = createChatbotRouter;
const express_1 = __importDefault(require("express"));
const genai_1 = require("@google/genai");
const order_model_1 = __importDefault(require("../models/order.model"));
const menu_1 = require("./menu");
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const SESSION_TTL_SECONDS = 60 * 60 * 24; // 24h
function createChatbotRouter(redis, p0) {
    const router = express_1.default.Router();
    const ai = GEMINI_API_KEY ? new genai_1.GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
    /* ---------- session helpers ---------- */
    async function getSession(userId) {
        const raw = await redis.get(`rps:chat:session:${userId}`);
        return raw ? JSON.parse(raw) : null;
    }
    async function setSession(userId, session) {
        session.updatedAt = Date.now();
        await redis.set(`rps:chat:session:${userId}`, JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
    }
    async function clearSession(userId) {
        await redis.del(`rps:chat:session:${userId}`);
    }
    /* ---------- WhatsApp helper ---------- */
    async function sendWhatsAppMessage(toNumber, text) {
        if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
            console.warn("WhatsApp config missing - cannot send message");
            return { ok: false, error: "WhatsApp not configured" };
        }
        const url = `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const body = {
            messaging_product: "whatsapp",
            to: toNumber,
            text: { body: text },
        };
        const resp = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (!resp.ok) {
            console.error("WhatsApp send error", data);
            return { ok: false, error: data };
        }
        return { ok: true, data };
    }
    /* ---------- AI helper ---------- */
    async function askAi(userMessage, context = "") {
        if (!ai) {
            return "Thank you for your message. You can contact support at: +254 758 982 859.";
        }
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
        }
        catch (err) {
            console.error("AI error:", err);
            return "Sorry — Your Assistant is currently unavailable. Contact: +254 758 982 859";
        }
    }
    async function extractAiText(resp) {
        try {
            if (!resp)
                return "";
            if (resp?.response?.text && typeof resp.response.text === "function") {
                return await resp.response.text();
            }
            if (resp?.candidates?.[0]?.content?.parts?.[0]?.text)
                return resp.candidates[0].content.parts[0].text;
            if (resp?.response?.candidates?.[0]?.content?.parts?.[0]?.text)
                return resp.response.candidates[0].content.parts[0].text;
            if (resp?.output?.[0]?.text)
                return resp.output[0].text;
            if (typeof resp === "string")
                return resp;
            return JSON.stringify(resp).slice(0, 400);
        }
        catch {
            return "Sorry — unable to extract AI reply.";
        }
    }
    /* ---------- Agent handover ---------- */
    async function createAgentTicket(phone, userId, message) {
        try {
            const t = await order_model_1.default.create({
                userPhone: phone,
                userId,
                subject: "Chatbot handover request",
                message,
                status: "OPEN",
            });
            return { ticket: { id: t._id.toString(), message }, success: true };
        }
        catch (err) {
            console.error("createAgentTicket error:", err);
            return { success: false, error: err?.message || "DB error" };
        }
    }
    async function notifyStaff(ticketIdOrPayload) {
        try {
            await redis.publish("rps:agent:notify", JSON.stringify(ticketIdOrPayload));
            const ADMIN_NUMBERS = ["254701170056", "254723970032"];
            const msg = typeof ticketIdOrPayload === "string"
                ? ticketIdOrPayload
                : `📩 New Support Ticket\n\nID: ${ticketIdOrPayload.ticket?.id ?? "N/A"}\nFrom: ${ticketIdOrPayload.from}\nMessage: ${ticketIdOrPayload.ticket?.message ?? "No message"}\n\nPlease log in to handle this query.`;
            for (const admin of ADMIN_NUMBERS) {
                await sendWhatsAppMessage(admin, msg);
            }
            console.log("✅ Staff notified via WhatsApp + Redis");
        }
        catch (err) {
            console.warn("⚠️ notifyStaff failed", err);
        }
    }
    /* ---------- core chatbot flow ---------- */
    /* ---------- AI prompt helper ---------- */
    function aiPromptForStep(step) {
        switch (step) {
            case "kcse":
                return "You are Right Path Schools Assistant. Answer questions related to KCSE Programme, fees, subjects, or admission.";
            case "igcse":
                return "You are Right Path Schools Assistant. Answer questions related to IGCSE Programme, fees, subjects, or admission.";
            case "ict":
                return "You are Right Path Schools Assistant. Answer questions related to ICT courses, fees, and enrollment.";
            case "languages":
                return "You are Right Path Schools Assistant. Answer questions related to Language courses, fees, and enrollment.";
            case "agent_wait":
                return "You are Right Path Schools Assistant helping while user waits for an agent. Answer questions about any programme offered by Right Path Schools.";
            default:
                return "You are Right Path Schools Assistant. Answer questions about any programme offered by Right Path Schools.";
        }
    }
    /* ---------- Updated handleIncomingMessage ---------- */
    async function handleIncomingMessage(userId, messageRaw, channel = "web", phone) {
        const message = (messageRaw || "").trim();
        let session = (await getSession(userId)) || { step: "welcome", context: {} };
        // Store phone in session if provided
        if (phone) {
            session.context = session.context || {};
            session.context.userPhone = phone;
            await setSession(userId, session);
        }
        const lower = message.toLowerCase();
        // --- Helpers ---
        const isGreeting = (msg) => {
            const greetings = ["hi", "hello", "hey", "good morning", "good afternoon", "good evening"];
            return msg && greetings.some(g => msg.toLowerCase().startsWith(g));
        };
        const looksLikeQuestion = (msg) => {
            const questionWords = ["how", "what", "when", "where", "who", "why", "which", "can", "does", "is", "are", "do", "could", "should", "would"];
            const text = msg.toLowerCase();
            return text.endsWith("?") || questionWords.some(w => text.startsWith(w + " ") || text.includes(" " + w + " "));
        };
        // --- Global shortcuts: Main menu / Cancel ---
        if (lower === "9") {
            session.step = "welcome";
            session.handedToAgent = false; // Cancel agent handover
            await setSession(userId, session);
            return `👋 Back to main menu:\n\n${menu_1.MAIN_MENU.join("\n")}`;
        }
        if (lower === "8") {
            if (session.handedToAgent) {
                await notifyStaff({
                    type: "handover_cancel",
                    from: session.context?.userPhone || userId,
                    phone: session.context?.userPhone || "Unknown",
                    message: "User cancelled agent handover",
                });
            }
            session = { step: "welcome", context: {} };
            await setSession(userId, session);
            return `❌ Operation cancelled. Back to main menu:\n\n${menu_1.MAIN_MENU.join("\n")}`;
        }
        // --- Greeting ---
        if (isGreeting(message)) {
            session.step = "welcome";
            await setSession(userId, session);
            return `👋 Hello! Welcome to Right Path Schools Assistant.\nPlease choose a service:\n\n${menu_1.MAIN_MENU.join("\n")}`;
        }
        // --- Step routing ---
        switch (session.step) {
            // ----------------- Welcome -----------------
            case "welcome":
                if (/^\d+$/.test(message)) {
                    switch (message) {
                        case "1":
                            session.step = "kcse";
                            await setSession(userId, session);
                            return menu_1.KCSE_MENU_TEXT + "\n9️⃣ Main Menu\n8️⃣ Cancel";
                        case "2":
                            session.step = "igcse";
                            await setSession(userId, session);
                            return menu_1.IGCSE_MENU_TEXT + "\n9️⃣ Main Menu\n8️⃣ Cancel";
                        case "3":
                            session.step = "ict";
                            await setSession(userId, session);
                            return menu_1.ICT_MENU_TEXT + "\n9️⃣ Main Menu\n8️⃣ Cancel";
                        case "4":
                            session.step = "languages";
                            await setSession(userId, session);
                            return menu_1.LANGUAGES_MENU_TEXT + "\n9️⃣ Main Menu\n8️⃣ Cancel";
                        case "5":
                            await setSession(userId, session);
                            return menu_1.ADMISSION_REQUIREMENTS + "\n9️⃣ Main Menu\n8️⃣ Cancel";
                        case "6":
                            // WhatsApp users: phone auto exists
                            if (channel === "whatsapp") {
                                session.context = session.context || {};
                                session.context.userPhone = phone || userId;
                                session.step = "agent_wait";
                                session.handedToAgent = true;
                                await setSession(userId, session);
                                const ticketResult = await createAgentTicket(userId, session.context.userPhone, "Student requested agent handover");
                                await notifyStaff({
                                    type: "handover",
                                    from: session.context.userPhone,
                                    phone: session.context.userPhone,
                                    ticket: ticketResult.ticket,
                                });
                                return `👩‍💼 You're being connected to an agent. An agent will reply shortly.\n9️⃣ Main Menu\n8️⃣ Cancel`;
                            }
                            // Web users: check if phone exists
                            if (!session.context?.userPhone) {
                                session.step = "collect_phone";
                                await setSession(userId, session);
                                return "📱 Please enter your phone number (e.g., +254712345678) to connect to an agent.\n9️⃣ Main Menu\n8️⃣ Cancel";
                            }
                            // Web user already has phone in session
                            session.step = "agent_wait";
                            session.handedToAgent = true;
                            await setSession(userId, session);
                            const phoneForTicket = session.context.userPhone;
                            const ticketResult = await createAgentTicket(userId, phoneForTicket, "Student requested agent handover");
                            await notifyStaff({
                                type: "handover",
                                from: phoneForTicket,
                                phone: phoneForTicket,
                                ticket: ticketResult.ticket,
                            });
                            return `👩‍💼 You're being connected to an agent. An agent will reply shortly.\n9️⃣ Main Menu\n8️⃣ Cancel`;
                        default:
                            return `❗Invalid option. Please choose:\n\n${menu_1.MAIN_MENU.join("\n")}\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    }
                }
                return `👋 Hello! Welcome to Right Path Schools Assistant.\nPlease choose a service:\n\n${menu_1.MAIN_MENU.join("\n")}\n9️⃣ Main Menu\n8️⃣ Cancel`;
            // ----------------- Collect Phone (Web) -----------------
            case "collect_phone":
                if (!/^\+?\d{9,15}$/.test(message))
                    return "❗Please enter a valid phone number including country code (e.g., +254712345678).\n9️⃣ Main Menu\n8️⃣ Cancel";
                session.context = session.context || {};
                session.context.userPhone = message;
                session.step = "agent_wait";
                session.handedToAgent = true;
                await setSession(userId, session);
                const ticket = await createAgentTicket(userId, message, "Web user provided phone number and requested agent handover");
                await notifyStaff({ type: "handover", from: userId, phone: message, ticket: ticket.ticket });
                return `✅ Thanks! You're being connected to an agent now. We'll reach you via ${message}. Please wait...\n9️⃣ Main Menu\n8️⃣ Cancel`;
            // ----------------- KCSE -----------------
            case "kcse":
                switch (message) {
                    case "1": return menu_1.ADMISSION_REQUIREMENTS + "\n9️⃣ Main Menu\n8️⃣ Cancel";
                    case "2": return menu_1.KCSE_FEES_MENU + "\n9️⃣ Main Menu\n8️⃣ Cancel";
                    case "3": return menu_1.KCSE_SET_BOOKS_MAIN_MENU + "\n9️⃣ Main Menu\n8️⃣ Cancel";
                    case "0":
                    case "9":
                        session.step = "welcome";
                        await setSession(userId, session);
                        return `👋 Main Menu:\n\n${menu_1.MAIN_MENU.join("\n")}`;
                    default:
                        if (looksLikeQuestion(message)) {
                            const prompt = aiPromptForStep("kcse");
                            return await askAi(message, prompt);
                        }
                        return `❗Invalid input. Please select an option or type '9' for main menu.\n\n${menu_1.KCSE_MENU_TEXT}\n9️⃣ Main Menu\n8️⃣ Cancel`;
                }
            // ----------------- IGCSE -----------------
            case "igcse":
                switch (message) {
                    case "1": return `Subjects Offered: English, Math, Biology, Chemistry, Physics, ICT, etc.\n0️⃣ Back\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    case "2": return `Admission requires ID/passport, report, 2 photos, registration fee.\n0️⃣ Back\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    case "3": return `Fees range KES 120,000 – 420,000 per term. Contact us for details.\n0️⃣ Back\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    case "0":
                    case "9":
                        session.step = "welcome";
                        await setSession(userId, session);
                        return `👋 Main Menu:\n\n${menu_1.MAIN_MENU.join("\n")}`;
                    default:
                        if (looksLikeQuestion(message)) {
                            const prompt = aiPromptForStep("igcse");
                            return await askAi(message, prompt);
                        }
                        return `❗Invalid input. Please select an option or type '9' for main menu.\n\n${menu_1.IGCSE_MENU_TEXT}\n9️⃣ Main Menu\n8️⃣ Cancel`;
                }
            // ----------------- ICT -----------------
            case "ict":
                switch (message) {
                    case "1": return `Certificate (3-12 months), Diploma (1-2 years), Short (2w–3m).\n0️⃣ Back\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    case "2": return `Fees: Short courses Ksh 5–18k, Diploma ~15k/term.\n0️⃣ Back\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    case "3": return `To enroll, visit: https://rightpathschools.site/join-us\n0️⃣ Back\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    case "0":
                    case "9":
                        session.step = "welcome";
                        await setSession(userId, session);
                        return `👋 Main Menu:\n\n${menu_1.MAIN_MENU.join("\n")}`;
                    default:
                        if (looksLikeQuestion(message)) {
                            const prompt = aiPromptForStep("ict");
                            return await askAi(message, prompt);
                        }
                        return `❗Invalid input. Please select an option or type '9' for main menu.\n\n${menu_1.ICT_MENU_TEXT}\n9️⃣ Main Menu\n8️⃣ Cancel`;
                }
            // ----------------- Languages -----------------
            case "languages":
                switch (message) {
                    case "1": return `Duration: 3–6 months; boosters 2–8 weeks.\n0️⃣ Back\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    case "2": return `Fees: Ksh 10k–15k per term; boosters Ksh 5k–12k.\n0️⃣ Back\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    case "3": return `To enroll, visit: https://rightpathschools.site/join-us\n0️⃣ Back\n9️⃣ Main Menu\n8️⃣ Cancel`;
                    case "0":
                    case "9":
                        session.step = "welcome";
                        await setSession(userId, session);
                        return `👋 Main Menu:\n\n${menu_1.MAIN_MENU.join("\n")}`;
                    default:
                        if (looksLikeQuestion(message)) {
                            const prompt = aiPromptForStep("languages");
                            return await askAi(message, prompt);
                        }
                        return `❗Invalid input. Please select an option or type '9' for main menu.\n\n${menu_1.LANGUAGES_MENU_TEXT}\n9️⃣ Main Menu\n8️⃣ Cancel`;
                }
            // ----------------- Waiting for agent -----------------
            case "agent_wait":
                if (lower === "8") {
                    await notifyStaff({
                        type: "handover_cancel",
                        from: session.context?.userPhone || userId,
                        phone: session.context?.userPhone || "Unknown",
                        message: "User cancelled agent handover",
                    });
                    session = { step: "welcome", context: {} };
                    await setSession(userId, session);
                    return `❌ Handover cancelled. Back to main menu:\n\n${menu_1.MAIN_MENU.join("\n")}`;
                }
                if (looksLikeQuestion(message)) {
                    const prompt = aiPromptForStep("agent_wait");
                    return await askAi(message, prompt);
                }
                return "You're waiting for an agent. Type 8️⃣ to cancel or 9️⃣ to go back to the main menu.";
            // ----------------- Default fallback -----------------
            default:
                session = { step: "welcome", context: {} };
                await setSession(userId, session);
                return `👋 Welcome to Right Path Schools Assistant.\nPlease choose a service:\n\n${menu_1.MAIN_MENU.join("\n")}\n9️⃣ Main Menu\n8️⃣ Cancel`;
        }
    }
    /* ---------- Express endpoints ---------- */
    // In your chatbot router
    router.post("/message", async (req, res) => {
        const { userId, message, channel = "web", phone } = req.body;
        if (!userId || !message) {
            return res.status(400).json({ error: "userId and message required" });
        }
        try {
            // Pass phone to handleIncomingMessage
            const reply = await handleIncomingMessage(userId, message, channel, phone);
            // If WhatsApp, send directly
            if (channel === "whatsapp") {
                await sendWhatsAppMessage(userId, reply);
            }
            res.json({ reply });
        }
        catch (err) {
            console.error("handleIncomingMessage error:", err);
            res.json({ reply: "⚠️ Connection error. Please try again later." });
        }
    });
    router.post("/webhook", async (req, res) => {
        const body = req.body;
        if (body?.from && body?.message) {
            const reply = await handleIncomingMessage(body.from, body.message, body.channel || "web");
            if (body.channel === "whatsapp" && body.replyViaWhatsApp)
                await sendWhatsAppMessage(body.from, reply);
            return res.json({ reply });
        }
        if (body?.object && Array.isArray(body.entry)) {
            for (const entry of body.entry) {
                for (const change of entry.changes || []) {
                    const value = change.value || {};
                    if (value?.messages && Array.isArray(value.messages)) {
                        for (const msg of value.messages) {
                            const from = msg.from;
                            let text = msg.text?.body || msg.button?.text || msg.interactive?.button_reply?.title || "";
                            const replyText = await handleIncomingMessage(from, text, "whatsapp");
                            await sendWhatsAppMessage(from, replyText);
                        }
                    }
                }
            }
            return res.status(200).send("EVENT_RECEIVED");
        }
        res.status(400).json({ error: "Unrecognized webhook payload" });
    });
    router.get("/webhook", (req, res) => {
        const VERIFY_TOKEN = "sg36jsgdskoi74";
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];
        console.log("Webhook verification attempt:", { mode, token, challenge });
        if (mode === "subscribe" && token === VERIFY_TOKEN) {
            console.log("✅ Verification successful");
            return res.status(200).send(challenge);
        }
        console.warn("❌ Verification failed");
        return res.sendStatus(403);
    });
    router.post("/send", async (req, res) => {
        const { to, message, via } = req.body;
        if (!to || !message)
            return res.status(400).json({ error: "Missing to or message" });
        if (via === "whatsapp") {
            const out = await sendWhatsAppMessage(to, message);
            return res.json(out);
        }
        const reply = await handleIncomingMessage(to, message, "web");
        res.json({ reply });
    });
    router.get("/health", (_req, res) => res.json({ status: "ok", time: Date.now() }));
    return router;
}
