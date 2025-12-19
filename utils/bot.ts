// chatbot/colltechHubBot.ts
import { normalizePhone, sendHandoverTemplate } from "./auth";

export type ChatbotButton = {
  label: string;
  nextId?: string;        // for chatbot flow
  route?: string;         // for app navigation
  action?: "handover";
};

export type ChatbotNode = {
  id: string;
  message: string;
  buttons?: ChatbotButton[];
  action?: "handover"; // optional property
};

export const colltechHubChatbot: Record<string, ChatbotNode> = {
  // -------------------- START --------------------
  start: {
    id: "start",
    message: "👋 Hello! Welcome to COLCHAT. How can I help you today? Pick one of the options below",
    buttons: [
      { label: "🛒 Products", nextId: "products" },
      { label: "💼 Services", nextId: "services" },
      { label: "❓ FAQs", nextId: "faqs" },
      { label: "📄 About Us", nextId: "about" },
      { label: "📞 Contact Support", nextId: "agent_handover" },
    ],
  },

  // -------------------- PRODUCTS --------------------
  products: {
    id: "products",
    message: "We offer the following product categories. Which are you interested in?",
    buttons: [
      { label: "📱 Phone Accessories", nextId: "category_phone" },
      { label: "💻 Computer Accessories", nextId: "category_computer" },
      { label: "🖇 Stationery", nextId: "category_stationery" },
      { label: "📺 Electronics", nextId: "category_electronics" },
      { label: "🌐 Internet Accessories", nextId: "category_internet" },
      { label: "🔙 Go Back", nextId: "start" },
    ],
  },
  category_phone: {
    id: "category_phone",
    message: "Our Phone Accessories include earphones, chargers, cases, etc. Visit our store to explore or ask a question.",
    buttons: [{ label: "🔙 Back to Products", nextId: "products" }],
  },
  category_computer: {
    id: "category_computer",
    message: "Our Computer Accessories include keyboards, mice, webcams, and more. Visit our store to explore or ask a question.",
    buttons: [{ label: "🔙 Back to Products", nextId: "products" }],
  },
  category_stationery: {
    id: "category_stationery",
    message: "We have pens, notebooks, printers, and all essential office stationery. Visit our store to explore or ask a question.",
    buttons: [{ label: "🔙 Back to Products", nextId: "products" }],
  },
  category_electronics: {
    id: "category_electronics",
    message: "Explore routers, Bluetooth speakers, earphones, and other electronics. Visit our store to explore or ask a question.",
    buttons: [{ label: "🔙 Back to Products", nextId: "products" }],
  },
  category_internet: {
    id: "category_internet",
    message: "We provide internet modems, routers, and accessories. Visit our store to explore or ask a question.",
    buttons: [{ label: "🔙 Back to Products", nextId: "products" }],
  },

  // -------------------- SERVICES --------------------
  services: {
    id: "services",
    message: "We offer a variety of services. Choose one to learn more.",
    buttons: [
      { label: "🌐 Internet Browsing", nextId: "service_internet_browsing" },
      { label: "📧 Email & Social Media", nextId: "service_email" },
      { label: "🖨 Printing & Photocopying", nextId: "service_printing" },
      { label: "⌨ Typing Services", nextId: "service_typing" },
      { label: "📝 Government Forms", nextId: "service_forms" },
      { label: "💻 Online Learning Support", nextId: "service_learning" },
      { label: "🎮 Gaming & Esports", nextId: "service_gaming" },
      { label: "🎨 Design & Marketing", nextId: "service_design" },
      { label: "🖼 Photo Editing & Passport Photos", nextId: "service_photo" },
      { label: "🔙 Go Back", nextId: "start" },
    ],
  },
  service_internet_browsing: {
    id: "service_internet_browsing",
    message: "Internet Browsing service is charged per hour. Ask us for current rates or booking options.",
    buttons: [{ label: "🔙 Back to Services", nextId: "services" }],
  },
  service_email: {
    id: "service_email",
    message: "Email & Social Media services are charged per hour. Ask for assistance to get started.",
    buttons: [{ label: "🔙 Back to Services", nextId: "services" }],
  },
  service_printing: {
    id: "service_printing",
    message: "Printing & Photocopying is charged per page. You can place your order or visit the center.",
    buttons: [{ label: "🔙 Back to Services", nextId: "services" }],
  },
  service_typing: {
    id: "service_typing",
    message: "Typing services are charged per page. Contact us for more info.",
    buttons: [{ label: "🔙 Back to Services", nextId: "services" }],
  },
  service_forms: {
    id: "service_forms",
    message: "Government Forms service has fixed pricing. Contact support for details.",
    buttons: [{ label: "🔙 Back to Services", nextId: "services" }],
  },
  service_learning: {
    id: "service_learning",
    message: "Online Learning Support is charged per session. Schedule a session via our support team.",
    buttons: [{ label: "🔙 Back to Services", nextId: "services" }],
  },
  service_gaming: {
    id: "service_gaming",
    message: "Gaming & Esports services are charged per hour. Contact support to book.",
    buttons: [{ label: "🔙 Back to Services", nextId: "services" }],
  },
  service_design: {
    id: "service_design",
    message: "Design & Marketing services are project-based. Contact support for quotes.",
    buttons: [{ label: "🔙 Back to Services", nextId: "services" }],
  },
  service_photo: {
    id: "service_photo",
    message: "Photo Editing & Passport Photos are per set. Contact us to place an order.",
    buttons: [{ label: "🔙 Back to Services", nextId: "services" }],
  },

  // -------------------- FAQ --------------------
  faqs: {
    id: "faqs",
    message: "Here are some frequently asked questions. Tap a question to get an answer, or contact support for more info.",
    buttons: [
      { label: "How do I place an order?", nextId: "faq_order" },
      { label: "Delivery info?", nextId: "faq_delivery" },
      { label: "Payment methods?", nextId: "faq_payment" },
      { label: "Returns & refunds?", nextId: "faq_returns" },
      { label: "Warranty?", nextId: "faq_warranty" },
      { label: "Account required?", nextId: "faq_account" },
      { label: "Contact support", nextId: "agent_handover" },
      { label: "🔙 Go Back", nextId: "start" },
    ],
  },
  faq_order: { id: "faq_order", message: "To place an order: Browse products, add to cart, checkout using M-Pesa, card, or mobile banking. Confirmation sent via SMS/email.", buttons: [{ label: "🔙 Back to FAQs", nextId: "faqs" }] },
  faq_delivery: { id: "faq_delivery", message: "Delivery: 1–3 working days in major towns, up to 5 in remote areas. Same-day available in select locations.", buttons: [{ label: "🔙 Back to FAQs", nextId: "faqs" }] },
  faq_payment: { id: "faq_payment", message: "Payment methods: M-Pesa, debit/credit cards, and selected mobile banking options.", buttons: [{ label: "🔙 Back to FAQs", nextId: "faqs" }] },
  faq_returns: { id: "faq_returns", message: "Returns accepted within 7 days if items meet our return policy. Refunds processed in 3–5 working days.", buttons: [{ label: "🔙 Back to FAQs", nextId: "faqs" }] },
  faq_warranty: { id: "faq_warranty", message: "Most electronics have manufacturer warranties. Details listed per product.", buttons: [{ label: "🔙 Back to FAQs", nextId: "faqs" }] },
  faq_account: { id: "faq_account", message: "No account required for guest checkout. Accounts help track orders and speed checkout.", buttons: [{ label: "🔙 Back to FAQs", nextId: "faqs" }] },

  // -------------------- ABOUT --------------------
  about: { id: "about", message: "COLLTECH Hub: Trusted partner for tech gadgets & office supplies in Kenya. Founded by Collins Otieno. Mission: quality tech, accessible & affordable. Vision: be the go-to destination.", buttons: [{ label: "Privacy Policy", nextId: "privacy_policy" }, { label: "🔙 Go Back", nextId: "start" }] },
  privacy_policy: { id: "privacy_policy", message: "We respect your privacy. We collect data to process orders, improve services, and communicate updates. Data is secured & shared only with essential partners. Contact support for details.", buttons: [{ label: "🔙 Back to About", nextId: "about" }] },

  // -------------------- AGENT HANDOVER --------------------
  agent_handover: {
    id: "agent_handover",
    message: "Please provide your WhatsApp number so our support agent can contact you.",
    buttons: [],
    action: "handover",
  },

  // -------------------- HANDOVER SUCCESS --------------------
  // -------------------- HANDOVER SUCCESS --------------------
handover_success: {
  id: "handover_success",
  message:
    "✅ Thanks! Our support agent has been notified and will contact you shortly.",
  buttons: [],
},
};

// -------------------- HANDOVER FUNCTION --------------------
export async function handoverToAgent(rawPhone: string) {
  const userPhone = normalizePhone(rawPhone);

  const supportPhone = process.env.SUPPORT_WHATSAPP_NUMBER;
  if (!supportPhone) {
    throw new Error("SUPPORT_WHATSAPP_NUMBER is not configured");
  }

  await sendHandoverTemplate(supportPhone, userPhone);

  // return handover success node text
  return colltechHubChatbot.handover_success.message;
}
