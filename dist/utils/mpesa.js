"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initiateMpesaStkPush = initiateMpesaStkPush;
const axios_1 = __importDefault(require("axios"));
const ioredis_1 = __importDefault(require("ioredis"));
const redis = new ioredis_1.default(process.env.REDIS_URL);
// Normalize phone number to 2547XXXXXXXX
function normalizePhoneNumber(phone) {
    phone = phone.replace(/[\s\-\+]/g, "");
    if (phone.startsWith("0"))
        return "254" + phone.substring(1);
    if (phone.startsWith("254"))
        return phone;
    if (phone.startsWith("7"))
        return "254" + phone;
    throw new Error("Invalid phone number format");
}
// Timestamp helper
const pad = (n) => n.toString().padStart(2, "0");
const getTimestamp = () => {
    const now = new Date();
    return (now.getFullYear().toString() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds()));
};
// ------------------------
// Initiate STK Push
// ------------------------
async function initiateMpesaStkPush(payload) {
    const { amount, phoneNumber, accountReference, description, userId, fullName, address, county, city, productDetails, } = payload;
    const normalizedPhone = normalizePhoneNumber(phoneNumber);
    const shortCode = process.env.MPESA_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const callbackUrl = `${process.env.BASE_URL}/api/webhook`;
    const timestamp = getTimestamp();
    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString("base64");
    try {
        // 1️⃣ Get access token
        const authRes = await axios_1.default.get("https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials", { auth: { username: consumerKey, password: consumerSecret } });
        const token = authRes.data.access_token;
        // 2️⃣ Initiate STK Push
        const stkRes = await axios_1.default.post("https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest", {
            BusinessShortCode: shortCode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: "CustomerBuyGoodsOnline",
            Amount: amount,
            PartyA: normalizedPhone,
            PartyB: 5692318,
            PhoneNumber: normalizedPhone,
            CallBackURL: callbackUrl,
            AccountReference: accountReference,
            TransactionDesc: description,
        }, { headers: { Authorization: `Bearer ${token}` } });
        // 3️⃣ Save order temporarily in Redis for webhook
        if (stkRes.data.CheckoutRequestID) {
            await redis.set(`pending_order:${stkRes.data.CheckoutRequestID}`, JSON.stringify({
                userId,
                fullName,
                phone: phoneNumber,
                address,
                county,
                city,
                totalAmount: amount,
                productDetails,
            }), "EX", 60 * 15 // expire in 15 minutes
            );
        }
        return stkRes.data;
    }
    catch (err) {
        console.error("[MPESA_STK_ERROR]", err);
        throw new Error("M-Pesa STK push failed");
    }
}
