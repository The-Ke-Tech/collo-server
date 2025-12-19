"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendHandoverTemplate = exports.sendTemporaryPassword = exports.sendWhatsappOtp = exports.resetKey = exports.resendKey = exports.regKey = exports.generateOtp = exports.RESEND_THROTTLE_SECONDS = exports.OTP_TTL_SECONDS = void 0;
exports.normalizePhone = normalizePhone;
exports.sendEmailOtp = sendEmailOtp;
exports.sendContactEmail = sendContactEmail;
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const nodemailer_1 = __importDefault(require("nodemailer"));
dotenv_1.default.config();
// ------------------------
// Constants
// ------------------------
exports.OTP_TTL_SECONDS = 7 * 60; // 7 minutes
exports.RESEND_THROTTLE_SECONDS = 60;
// ------------------------
// Helpers
// ------------------------
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();
exports.generateOtp = generateOtp;
// Redis keys
// Key for storing pending registration
const regKey = (email, normalizedPhone) => `reg:${email}:${normalizedPhone}`;
exports.regKey = regKey;
// Key for resend throttle
const resendKey = (email, normalizedPhone) => `reg:${email}:${normalizedPhone}:resend-lock`;
exports.resendKey = resendKey;
// Unique Redis key for password reset
const resetKey = (email, phone) => `reset:${email}:${phone}`;
exports.resetKey = resetKey;
// Phone normalization
function normalizePhone(raw) {
    if (!raw || typeof raw !== "string")
        return raw;
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("254") && digits.length === 12)
        return digits;
    if (digits.startsWith("0") && digits.length === 10)
        return "254" + digits.slice(1);
    if (digits.startsWith("7") && digits.length === 9)
        return "254" + digits;
    if (digits.startsWith("00254"))
        return digits.slice(2);
    return digits;
}
// ------------------------
// WhatsApp Config
// ------------------------
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.error("⚠️ Missing WhatsApp API environment variables!");
}
const sendWhatsappOtp = async (phone, code) => {
    try {
        await axios_1.default.post(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            messaging_product: "whatsapp",
            to: phone,
            type: "template",
            template: {
                name: "otp",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [{ type: "text", text: code }],
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: code }],
                    },
                ],
            },
        }, {
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
        });
        console.log(`✅ WhatsApp OTP sent to ${phone}`);
    }
    catch (err) {
        console.error("❌ WhatsApp OTP send failed:", err.response?.data || err.message);
    }
};
exports.sendWhatsappOtp = sendWhatsappOtp;
const sendTemporaryPassword = async (phone, password) => {
    try {
        await axios_1.default.post(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            messaging_product: "whatsapp",
            to: phone,
            type: "template",
            template: {
                name: "loginpassword",
                language: { code: "en_us" },
                components: [
                    {
                        type: "body",
                        parameters: [{ type: "text", text: password }],
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: "0",
                        parameters: [{ type: "text", text: password }],
                    },
                ],
            },
        }, {
            headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
        });
        console.log(`✅ WhatsApp password sent to ${phone}`);
    }
    catch (err) {
        console.error("❌ WhatsApp password send failed:", err.response?.data || err.message);
    }
};
exports.sendTemporaryPassword = sendTemporaryPassword;
// ------------------------
// General WhatsApp Sender
// ------------------------
/**
 * Send a freeform WhatsApp message (text only)
 * @param phone Recipient phone number
 * @param message Message text
 */
// ------------------------
// WhatsApp HANDOVER Template Sender
// ------------------------
const sendHandoverTemplate = async (adminPhone, userPhone) => {
    const normalizedAdmin = normalizePhone(adminPhone);
    const normalizedUser = normalizePhone(userPhone);
    try {
        await axios_1.default.post(`https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            messaging_product: "whatsapp",
            to: normalizedAdmin,
            type: "template",
            template: {
                name: "handover",
                language: { code: "en_US" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            {
                                type: "text",
                                text: normalizedUser,
                            },
                        ],
                    },
                ],
            },
        }, {
            headers: {
                Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                "Content-Type": "application/json",
            },
        });
        console.log(`✅ Handover template sent to ${normalizedAdmin}`);
    }
    catch (err) {
        console.error("❌ Handover template send failed:", err.response?.data || err.message);
    }
};
exports.sendHandoverTemplate = sendHandoverTemplate;
// ------------------------
// Email OTP Sender
// ------------------------
const STORE_NAME = process.env.STORE_NAME || "STORE";
const STORE_LOGO_URL = process.env.STORE_LOGO_URL || "";
const EMAIL_FROM = process.env.SMTP_USER;
const CONTACT_EMAIL = process.env.CONTACT_RECEIVER_EMAIL || EMAIL_FROM;
const transporter = nodemailer_1.default.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 465,
    secure: true, // Gmail SMTP over 465 MUST be secure:true
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});
/**
 * Sends OTP email with branded header + footer
 */
async function sendEmailOtp(email, otp) {
    const subject = `${STORE_NAME} - Your Verification Code`;
    const htmlContent = `
  <div style="font-family: Arial, sans-serif; background:#f5f5f5; padding:30px;">
    <table width="100%" cellpadding="0" cellspacing="0"
      style="max-width:600px; margin:auto; background:white; border-radius:8px; overflow:hidden;">

      <!-- HEADER -->
      <tr style="background:#7B2CBF;">
        <td style="padding:30px 20px; text-align:center;">

          ${STORE_LOGO_URL
        ? `
                <div style="
                  width:120px;
                  height:120px;
                  background:white;
                  border-radius:20px; /* reduced from circular */
                  display:flex;
                  justify-content:center;
                  align-items:center;
                  margin:0 auto 12px auto;
                  box-shadow:0 2px 5px rgba(0,0,0,0.15);
                ">
                  <img src="${STORE_LOGO_URL}" alt="${STORE_NAME}" 
                    style="max-width:80%; max-height:80%; border-radius:10px;" />
                </div>
              `
        : ""}

          <h2 style="color:white; margin:0; font-size:24px; font-weight:bold;">
            ${STORE_NAME}
          </h2>
        </td>
      </tr>

      <!-- BODY -->
      <tr>
        <td style="padding:30px; color:#444; font-size:16px; line-height:1.6;">
          <p>Hello,</p>
          <p>Your One-Time Password (OTP) for verification is:</p>

          <div style="
            font-size:36px;
            font-weight:bold;
            text-align:center;
            padding:25px 0;
            color:#7B2CBF;
            letter-spacing:5px;
          ">
            ${otp}
          </div>

          <p>This code expires in <strong>7 minutes</strong>.</p>
          <p>If you didn't request this, kindly ignore this email.</p>
        </td>
      </tr>

      <!-- FOOTER -->
      <tr>
        <td style="
          background:#1E3A8A;
          padding:18px;
          text-align:center;
          color:white;
          font-size:13px;
        ">
          © ${new Date().getFullYear()} ${STORE_NAME}. All rights reserved.<br/>
          For assistance: <strong style="color:#BBDEFF;">${process.env.CONTACT_RECEIVER_EMAIL}</strong>
        </td>
      </tr>

    </table>
  </div>
`;
    const textContent = `
${STORE_NAME} Verification Code

Your OTP is: ${otp}
Expires in 7 minutes.

If you did not request this, ignore this message.

${STORE_NAME} © ${new Date().getFullYear()}
Contact: ${process.env.CONTACT_RECEIVER_EMAIL}
`;
    try {
        await transporter.sendMail({
            from: `${STORE_NAME} <${EMAIL_FROM}>`,
            to: email,
            subject,
            html: htmlContent,
            text: textContent,
        });
        console.log(`📧 OTP Email sent to ${email}`);
    }
    catch (err) {
        console.error("❌ Email OTP failed:", err.message || err);
    }
}
async function sendContactEmail(form) {
    const subject = `[Contact Form] Message from ${form.name}`;
    const htmlContent = `
  <div style="font-family:Arial,sans-serif; background:#f5f5f5; padding:30px;">
    <table width="100%" cellpadding="0" cellspacing="0"
      style="max-width:600px; margin:auto; background:white; border-radius:8px; overflow:hidden;">
      <!-- HEADER -->
      <tr style="background:#7B2CBF;">
        <td style="padding:30px 20px; text-align:center;">
          ${STORE_LOGO_URL
        ? `<div style="width:120px; height:120px; background:white; border-radius:20px; display:flex; justify-content:center; align-items:center; margin:0 auto 12px auto; box-shadow:0 2px 5px rgba(0,0,0,0.15);">
                   <img src="${STORE_LOGO_URL}" alt="${STORE_NAME}" style="max-width:80%; max-height:80%; border-radius:10px;" />
                 </div>`
        : ""}
          <h2 style="color:white; margin:0; font-size:24px; font-weight:bold;">${STORE_NAME}</h2>
        </td>
      </tr>
      <!-- BODY -->
      <tr>
        <td style="padding:30px; color:#444; font-size:16px; line-height:1.6;">
          <p>You have received a new message from the contact form.</p>
          <p><strong>Name:</strong> ${form.name}</p>
          <p><strong>Email:</strong> ${form.email}</p>
          <p><strong>Message:</strong></p>
          <p style="padding:10px; background:#f0f0f0; border-radius:6px; border:1px solid #ddd;">${form.message}</p>
        </td>
      </tr>
      <!-- FOOTER -->
      <tr>
        <td style="background:#1E3A8A; padding:18px; text-align:center; color:white; font-size:13px;">
          © ${new Date().getFullYear()} ${STORE_NAME}. All rights reserved.<br/>
          Contact: <strong style="color:#BBDEFF;">${CONTACT_EMAIL}</strong>
        </td>
      </tr>
    </table>
  </div>
  `;
    const textContent = `
${STORE_NAME} - New Contact Message

Name: ${form.name}
Email: ${form.email}
Message:
${form.message}

${STORE_NAME} © ${new Date().getFullYear()}
Contact: ${CONTACT_EMAIL}
  `;
    try {
        await transporter.sendMail({ from: `${STORE_NAME} <${EMAIL_FROM}>`, to: CONTACT_EMAIL, subject, html: htmlContent, text: textContent });
        console.log(`📧 Contact form email sent from ${form.email}`);
    }
    catch (err) {
        console.error("❌ Contact email failed:", err.message || err);
        throw new Error("Failed to send contact email.");
    }
}
