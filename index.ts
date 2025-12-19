import express, { Request, Response } from "express";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import cors from "cors";
import jwt, { JwtPayload } from "jsonwebtoken";
import mongoose from "mongoose";
import Redis from "ioredis";
import slugify from "slugify";


import {
  OTP_TTL_SECONDS,
  RESEND_THROTTLE_SECONDS,
  generateOtp,
  regKey,
  resendKey,
  normalizePhone,
  sendWhatsappOtp,
  sendTemporaryPassword,
  sendEmailOtp,
  sendContactEmail,
  ContactFormData,
  resetKey,
} from "./utils/auth";
import cookieParser from "cookie-parser";

// Mongoose models (make sure these files exist)
import User, { IUser } from "./models/user.model";

import { authMiddleware, AuthRequest } from "./middleware";
import { generateAccessToken, generateRefreshToken } from "./utils/tokens";
import Product from "./models/product.model";
import CartItem from "./models/cart.model";
import Banner from "./models/banner.model";
import Order, { PaymentStatus, ShippingStage } from "./models/order.model";
import OrderProduct, { IOrderProduct } from "./models/orderProduct.model";
import { initiateMpesaStkPush } from "./utils/mpesa";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import Service from "./models/service.model";
import { colltechHubChatbot, handoverToAgent } from "./utils/bot";

dotenv.config();

const app = express();
app.use(cookieParser());

// ✅ Use CORS middleware
app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://192.168.1.106:3000",
      "http://10.216.235.76:3000",
      "http://192.168.0.103:3000",
      "https://www.colltechhub.com",
      "https://colltechhub.com",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// Redis
const redis = new Redis(process.env.REDIS_URL!);
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const JWT_SECRET = process.env.JWT_SECRET!

// ----------------------
// DB & Redis Connection Test (Mongoose)
// ----------------------
async function testConnections() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI!;
    if (!mongoUri) {
      console.error("❌ MONGO_URI not set in env");
      process.exit(1);
    }

    await mongoose.connect(mongoUri, {
      // useNewUrlParser and useUnifiedTopology are default in modern mongoose, but add options as needed
    });
    console.log("✅ MongoDB connected successfully");

    // Test Redis
    await redis.set("test-connection", "ok", "EX", 5);
    const ping = await redis.get("test-connection");
    if (ping === "ok") {
      console.log("✅ Redis connected successfully");
    } else {
      console.error("⚠️ Redis test failed");
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ Connection test failed:", err);
    process.exit(1);
  }
}


// ===============================
// REGISTER
// ----------------- SIGNUP -----------------
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password)
      return res.status(400).json({ success: false, message: "All fields are required" });

    const normalizedPhone = normalizePhone(phone);

    // Check if email or phone already exists in MongoDB
    const existingUser = await User.findOne({ $or: [{ email }, { phone: normalizedPhone }] });
    if (existingUser)
      return res.status(400).json({ success: false, message: "Email or phone already registered" });

    // Generate OTP and store temporary registration data in Redis
    const otp = generateOtp();
    const key = regKey(email, normalizedPhone); // unique Redis key per email + phone

    await redis.set(key, JSON.stringify({ name, email, phone: normalizedPhone, password }), "EX", OTP_TTL_SECONDS);
    await redis.set(`${key}:otp`, otp, "EX", OTP_TTL_SECONDS);

    // Send OTP via WhatsApp and Email
    await sendWhatsappOtp(normalizedPhone, otp);
    await sendEmailOtp(email, otp);

    return res.json({ success: true, message: "OTP sent to WhatsApp and Email. Verify to complete registration." });
  } catch (error: any) {
    console.error("Signup error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ----------------- VERIFY OTP -----------------
app.post("/api/auth/verify-otp", async (req, res) => {
  try {
    const { email, phone, otp } = req.body;
    if (!email || !phone || !otp)
      return res.status(400).json({ success: false, message: "All fields are required" });

    const normalizedPhone = normalizePhone(phone);
    const key = regKey(email, normalizedPhone);

    // Check OTP
    const storedOtp = await redis.get(`${key}:otp`);
    if (!storedOtp || storedOtp !== otp)
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });

    // Retrieve temporary registration data
    const tempUserData = await redis.get(key);
    if (!tempUserData)
      return res.status(400).json({ success: false, message: "User data expired. Register again." });

    const { name, password } = JSON.parse(tempUserData);

    // Save to MongoDB
    const user = new User({ name, email, phone: normalizedPhone, password });
    await user.save();

    // Cleanup Redis
    await redis.del(key);
    await redis.del(`${key}:otp`);

    return res.json({ success: true, message: "Account verified and created successfully." });
  } catch (error: any) {
    console.error("Verify OTP error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ----------------- RESEND SIGNUP OTP -----------------
app.post("/api/auth/resend-otp", async (req: Request, res: Response) => {
  try {
    const { email, phone } = req.body;
    if (!email || !phone)
      return res.status(400).json({ success: false, message: "Email and phone are required" });

    const normalizedPhone = normalizePhone(phone);
    const key = regKey(email, normalizedPhone);

    // ---------------- RESEND THROTTLE ----------------
    const resendLockKey = `${key}:resend`;
    const lock = await redis.get(resendLockKey);
    if (lock)
      return res.status(429).json({
        success: false,
        message: "Please wait 60 seconds before resending OTP",
      });

    await redis.set(resendLockKey, "locked", "EX", 60); // 60 seconds lock

    // ---------------- FETCH TEMP USER DATA ----------------
    const tempDataStr = await redis.get(key);
    if (!tempDataStr)
      return res.status(400).json({ success: false, message: "Registration data expired. Please signup again." });

    const tempData = JSON.parse(tempDataStr);

    // ---------------- GENERATE NEW OTP ----------------
    const newOtp = generateOtp();
    await redis.set(`${key}:otp`, newOtp, "EX", OTP_TTL_SECONDS);

    // ---------------- SEND OTP ----------------
    await sendWhatsappOtp(normalizedPhone, newOtp);
    await sendEmailOtp(email, newOtp);

    return res.json({ success: true, message: "OTP resent successfully" });
  } catch (err) {
    console.error("Resend OTP error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ----------------- REQUEST RESET OTP -----------------
app.post("/api/auth/request-reset", async (req: Request, res: Response) => {
  try {
    const { email, phone } = req.body;
    if (!email && !phone)
      return res.status(400).json({ success: false, message: "Email or phone is required" });

    const normalizedPhone = phone ? normalizePhone(phone) : undefined;
    const identifierKey = email ?? normalizedPhone ?? "";

    // ---------------- RESEND THROTTLE ----------------
    const resendLockKey = resendKey(email ?? "", normalizedPhone ?? "");
    const lock = await redis.get(resendLockKey);
    if (lock)
      return res.status(429).json({ success: false, message: `Wait ${RESEND_THROTTLE_SECONDS} seconds before requesting again` });
    await redis.set(resendLockKey, "locked", "EX", RESEND_THROTTLE_SECONDS);

    // ---------------- FIND USER ----------------
    const user = await User.findOne({ $or: [{ email }, { phone: normalizedPhone }] });
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    // ---------------- GENERATE OTP ----------------
    const otp = generateOtp(); // 6-digit
    const key = resetKey(email ?? "", normalizedPhone ?? "");

    await redis.set(key, JSON.stringify({ userId: user._id }), "EX", OTP_TTL_SECONDS);
    await redis.set(`${key}:otp`, otp, "EX", OTP_TTL_SECONDS);

    // ---------------- SEND OTP ----------------
    if (email) await sendEmailOtp(email, otp);
    if (normalizedPhone) await sendWhatsappOtp(normalizedPhone, otp);

    return res.json({ success: true, message: "OTP sent to your email/phone" });
  } catch (err) {
    console.error("Request reset OTP error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ----------------- VERIFY RESET OTP -----------------
app.post("/api/auth/verify-reset-otp", async (req: Request, res: Response) => {
  try {
    const { email, phone, otp } = req.body;
    if (!otp || (!email && !phone))
      return res.status(400).json({ success: false, message: "All fields are required" });

    const normalizedPhone = phone ? normalizePhone(phone) : undefined;
    const key = resetKey(email ?? "", normalizedPhone ?? "");

    const storedOtp = await redis.get(`${key}:otp`);
    if (!storedOtp || storedOtp !== otp)
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });

    return res.json({ success: true, message: "OTP verified" });
  } catch (err) {
    console.error("Verify reset OTP error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ----------------- RESET PASSWORD -----------------
app.post("/api/auth/reset-password", async (req: Request, res: Response) => {
  try {
    const { email, phone, newPassword } = req.body;
    if (!newPassword || (!email && !phone))
      return res.status(400).json({ success: false, message: "All fields are required" });

    const normalizedPhone = phone ? normalizePhone(phone) : undefined;
    const key = resetKey(email ?? "", normalizedPhone ?? "");

    const tempData = await redis.get(key);
    if (!tempData)
      return res.status(400).json({ success: false, message: "OTP expired. Request again." });

    const { userId } = JSON.parse(tempData);
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    user.password = newPassword;
    await user.save();

    await redis.del(key);
    await redis.del(`${key}:otp`);

    return res.json({ success: true, message: "Password reset successfully" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ----------------- LOGIN -----------------
const JWT_COOKIE_NAME = "refreshToken";

app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { emailOrPhone, password } = req.body;

    if (!emailOrPhone || !password)
      return res.status(400).json({
        success: false,
        message: "Email/Phone and password are required",
      });

    // Normalize Kenyan phone
    const normalizePhone = (p: string) => {
      if (!p) return p;
      p = p.replace(/\D/g, "");
      if (p.startsWith("07")) p = "254" + p.substring(1);
      if (p.startsWith("7") && p.length === 9) p = "254" + p;
      return p;
    };

    const normalizedPhone = normalizePhone(emailOrPhone);

    // Find user by email or phone
    const user = await User.findOne({
      $or: [
        { email: emailOrPhone.toLowerCase() },
        { phone: normalizedPhone },
      ],
    });

    if (!user)
      return res.status(400).json({ success: false, message: "Invalid credentials" });

    const isMatch = await user.comparePassword(password);
    if (!isMatch)
      return res.status(400).json({ success: false, message: "Invalid credentials" });

    // Payload for tokens
    const payload = { id: user._id, role: user.role };

    // Generate tokens
    const accessToken = generateAccessToken(payload);  // expires in 15m
    const refreshToken = generateRefreshToken(payload); // expires in 7d

    // Set refresh token as HTTP-only cookie
    res.cookie(JWT_COOKIE_NAME, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    // Send access token + user data
    return res.json({
      success: true,
      message: "Login successful",
      token: accessToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});



// ----------------- LOGOUT -----------------
// ----------------- LOGOUT -----------------
app.post("/api/auth/logout", async (req, res) => {
  try {
    return res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("LOGOUT ERROR:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

app.post("/api/auth/refresh", (req, res) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ message: "No refresh token" });

    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role: string };

    // Generate new access token
    const newAccessToken = generateAccessToken({ id: decoded.id, role: decoded.role });

    return res.json({ token: newAccessToken });
  } catch (err: any) {
    console.error("Refresh token error:", err.message);
    return res.status(401).json({ message: "Invalid refresh token" });
  }
});

// ----------------- CREATE PRODUCT -----------------
app.post(
  "/api/products",
  authMiddleware(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        productName,
        brandName,
        category,
        productImage,
        description,
        price,
        sellingPrice,
        stock,
      } = req.body;

      // 🔐 user comes from token, NOT client
      const createdBy = req.user!.id;

      if (!productName || !category) {
        return res.status(400).json({
          success: false,
          message: "Product name and category are required",
        });
      }

      const parsedPrice = Number(price);
      const parsedSellingPrice = Number(sellingPrice);
      const parsedStock = Number(stock);

      if (
        isNaN(parsedPrice) ||
        isNaN(parsedSellingPrice) ||
        isNaN(parsedStock)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid number values",
        });
      }

      const baseSlug = slugify(productName, { lower: true, strict: true });
      let slug = baseSlug;
      let counter = 1;

      while (await Product.exists({ slug })) {
        slug = `${baseSlug}-${counter++}`;
      }

      const product = await Product.create({
        productName,
        slug,
        brandName,
        category,
        productImage: productImage || [],
        description,
        price: parsedPrice,
        sellingPrice: parsedSellingPrice,
        stock: parsedStock,
        createdBy,
      });

      res.status(201).json({ success: true, data: product });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to create product",
        error: error.message,
      });
    }
  }
);


// ------------------------
// 🔹 CRUD for Products
// ------------------------

// GET all products
app.get("/api/products", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });
    res.json({ success: true, data: products });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch products", error: error.message });
  }
});


// GET product by slug
app.get("/api/products/slug/:slug", async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });
    if (!product)
      return res.status(404).json({ success: false, message: "Product not found" });

    res.json(product);
  } catch (err) {
    console.error("Fetch slug product error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// GET single product by ID
app.get("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, data: product });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch product", error: error.message });
  }
});

// GET product by ID
app.get("/api/products/id/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product)
      return res.status(404).json({ success: false, message: "Product not found" });

    res.json(product);
  } catch (err: any) {
    console.error("Fetch ID product error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


app.patch(
  "/api/products/:id",
  authMiddleware(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID",
        });
      }

      const updated = await Product.findByIdAndUpdate(
        id,
        req.body,
        { new: true, runValidators: true }
      );

      if (!updated) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      res.json({ success: true, data: updated });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to update product",
        error: error.message,
      });
    }
  }
);


// PUT replace entire product
app.put("/api/products/:id", async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    // Overwrite all fields
    product.productName = req.body.productName;
    product.slug = req.body.slug || product.slug;
    product.brandName = req.body.brandName;
    product.category = req.body.category;
    product.productImage = req.body.productImage || [];
    product.description = req.body.description;
    product.price = req.body.price;
    product.sellingPrice = req.body.sellingPrice;
    product.stock = req.body.stock;
    product.createdBy = req.body.createdBy;

    const saved = await product.save();
    res.json({ success: true, data: saved });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to replace product", error: error.message });
  }
});

app.delete(
  "/api/products/:id",
  authMiddleware(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid product ID",
        });
      }

      const deleted = await Product.findByIdAndDelete(id);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: "Product not found",
        });
      }

      res.json({
        success: true,
        message: "Product deleted successfully",
      });
    } catch (error: any) {
      console.error(error);
      res.status(500).json({
        success: false,
        message: "Failed to delete product",
        error: error.message,
      });
    }
  }
);


app.get("/api/products/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const product = await Product.findOne({ slug });

    if (!product) return res.status(404).json({ message: "Product not found" });

    return res.json(product);
  } catch (err) {
    console.error("GET product by slug error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});


// -------------------------
// GET: search products
// ?q=keyword
// -------------------------
// GET: search both services and products
app.get("/api/search", async (req: Request, res: Response) => {
  const q = req.query.q?.toString() || "";
  if (!q) return res.json({ success: true, data: [] });

  try {
    const regex = new RegExp(q, "i"); // case-insensitive

    // Search services
    const services = await Service.find({
      $or: [{ serviceName: regex }, { category: regex }],
    }).sort({ createdAt: -1 });

    // Search products
    const products = await Product.find({
      $or: [
        { productName: regex },
        { category: regex },
        { brandName: regex },
      ],
    }).sort({ createdAt: -1 });

    // Map results with type field for frontend
    const mappedServices = services.map(s => ({
      _id: s._id,
      name: s.serviceName,
      category: s.category,
      slug: s.slug,
      type: "service" as const,
    }));

    const mappedProducts = products.map(p => ({
      _id: p._id,
      name: p.productName,
      category: p.category,
      slug: p.slug,
      type: "product" as const,
    }));

    res.json({ success: true, data: [...mappedServices, ...mappedProducts] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


/**
 * POST /api/products/filter
 * Body: { category?: string[], sortBy?: "asc" | "dsc", search?: string }
 */
app.post("/api/products/filter", async (req, res) => {
  try {
    const { category, sortBy, search } = req.body;

    // Build query
    const query: any = {};
    if (category && category.length > 0) {
      query.category = { $in: category };
    }

    if (search && search.trim() !== "") {
      query.productName = { $regex: search.trim(), $options: "i" }; // case-insensitive search
    }

    // Sorting
    const sortQuery: any = {};
    if (sortBy === "asc") sortQuery.sellingPrice = 1;
    else if (sortBy === "dsc") sortQuery.sellingPrice = -1;
    else sortQuery.createdAt = -1; // default: newest first

    const products = await Product.find(query).sort(sortQuery).lean();

    res.json({ success: true, data: products });
  } catch (err) {
    console.error("Error fetching products:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// ------------------------
// 🔹 POST fetch category-wise products
// ------------------------
app.post("/api/products/category-wise", async (req, res) => {
  try {
    const { category } = req.body;
    if (!category) return res.status(400).json({ success: false, message: "Category is required" });

    const products = await Product.find({ category }).sort({ createdAt: -1 });
    res.json({ success: true, data: products });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ success: false, message: "Failed to fetch products", error: error.message });
  }
});

// GET /api/category-product
app.get("/api/category-product", async (req, res) => {
  try {
    // Fetch products with a category
    const products = await Product.find({ category: { $ne: null } })
      .sort({ createdAt: -1 }) // newest first
      .select("category productImage"); // only select what we need

    // Group by category and pick the first image
    const grouped: { category: string; productImage: string[] }[] = Object.values(
      products.reduce((acc: Record<string, { category: string; productImage: string[] }>, item) => {
        if (!item.category) return acc;

        if (!acc[item.category]) {
          acc[item.category] = {
            category: item.category,
            productImage: item.productImage.length ? [item.productImage[0]] : [],
          };
        }

        return acc;
      }, {})
    );

    res.json({ success: true, data: grouped });
  } catch (error: any) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ success: false, message: "Failed to fetch categories", error: error.message });
  }
});


// GET /api/category-service
app.get("/api/category-service", async (req, res) => {
  try {
    const services = await Service.find({ category: { $ne: null } })
      .sort({ createdAt: -1 })
      .select("category serviceImage");

    const grouped: { category: string; serviceImage: string[] }[] = Object.values(
      services.reduce(
        (
          acc: Record<string, { category: string; serviceImage: string[] }>,
          item
        ) => {
          if (!item.category) return acc;

          if (!acc[item.category]) {
            acc[item.category] = {
              category: item.category,
              serviceImage: item.serviceImage?.length
                ? [item.serviceImage[0]]
                : [],
            };
          }

          return acc;
        },
        {}
      )
    );

    res.json({ success: true, data: grouped });
  } catch (error: any) {
    console.error("Error fetching service categories:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch service categories",
      error: error.message,
    });
  }
});



// ----------------- CREATE SERVICE -----------------
app.post(
  "/api/services",
  authMiddleware(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        serviceName,
        category,
        serviceImage,
        description,
        price,
        startingFrom,
        pricingType,
        unitLabel,
      } = req.body;

      const createdBy = req.user!.id;

      if (!serviceName || !category) {
        return res.status(400).json({
          success: false,
          message: "Service name and category are required",
        });
      }

      const parsedPrice = Number(price);
      if (isNaN(parsedPrice)) {
        return res.status(400).json({ success: false, message: "Invalid price" });
      }

      // Generate unique slug
      const baseSlug = slugify(serviceName, { lower: true, strict: true });
      let slug = baseSlug;
      let counter = 1;

      while (await Service.exists({ slug })) {
        slug = `${baseSlug}-${counter++}`;
      }

      const service = await Service.create({
        serviceName,
        slug,
        category,
        serviceImage: serviceImage || [],
        description,
        price: parsedPrice,
        startingFrom: startingFrom ?? true,
        pricingType,
        unitLabel,
        createdBy,
      });

      res.status(201).json({ success: true, data: service });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({
        success: false,
        message: "Failed to create service",
        error: err.message,
      });
    }
  }
);

// ----------------- GET ALL SERVICES -----------------
app.get("/api/services", async (req, res) => {
  try {
    const services = await Service.find().sort({ createdAt: -1 });
    res.json({ success: true, data: services });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch services", error: err.message });
  }
});

// ----------------- GET SERVICE BY SLUG -----------------
app.get("/api/services/slug/:slug", async (req, res) => {
  try {
    const service = await Service.findOne({ slug: req.params.slug });
    if (!service)
      return res.status(404).json({ success: false, message: "Service not found" });

    res.json({ success: true, data: service });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ----------------- GET SERVICE BY ID -----------------
app.get("/api/services/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid service ID" });
    }

    const service = await Service.findById(id);
    if (!service) return res.status(404).json({ success: false, message: "Service not found" });

    res.json({ success: true, data: service });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch service", error: err.message });
  }
});

// ----------------- UPDATE SERVICE -----------------
app.patch(
  "/api/services/:id",
  authMiddleware(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid service ID" });
      }

      const updated = await Service.findByIdAndUpdate(
        id,
        req.body,
        { new: true, runValidators: true }
      );

      if (!updated) {
        return res.status(404).json({ success: false, message: "Service not found" });
      }

      res.json({ success: true, data: updated });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, message: "Failed to update service", error: err.message });
    }
  }
);

// ----------------- DELETE SERVICE -----------------
app.delete(
  "/api/services/:id",
  authMiddleware(["admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, message: "Invalid service ID" });
      }

      const deleted = await Service.findByIdAndDelete(id);
      if (!deleted) return res.status(404).json({ success: false, message: "Service not found" });

      res.json({ success: true, message: "Service deleted successfully" });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ success: false, message: "Failed to delete service", error: err.message });
    }
  }
);

// ----------------- SEARCH SERVICES -----------------
app.get("/api/services/search", async (req: Request, res: Response) => {
  const q = req.query.q?.toString() || "";
  if (!q) return res.json([]);

  try {
    const regex = new RegExp(q, "i");
    const services = await Service.find({
      $or: [{ serviceName: regex }, { category: regex }],
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: services });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


interface PopulatedProduct {
  _id: string;
  productName: string;
  productImage: string[];
  price?: number;
  sellingPrice?: number;
  stock: number;
}


app.get("/api/cart", authMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    const cartItems = await CartItem.find({ userId }).populate(
      "productId",
      "productName productImage price sellingPrice stock"
    );

    const formattedItems = cartItems.map((item) => {
  const product = item.productId as unknown as PopulatedProduct;
  return {
    productId: product._id,
    quantity: item.quantity,
    product: {
      _id: product._id,
      productName: product.productName,
      productImage: product.productImage,
      price: product.price,
      sellingPrice: product.sellingPrice,
      stock: product.stock,
    },
  };
});


    res.json({ success: true, count: formattedItems.length, items: formattedItems });
  } catch (err: any) {
    console.error("Error fetching cart:", err);
    res.status(500).json({ success: false, message: "Failed to fetch cart", error: err.message });
  }
});



// -------------------
// POST /api/cart/add
// Add product to cart (no increment, only create if not exists)
// -------------------
app.post("/api/cart/add", authMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { productId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const existingCartItem = await CartItem.findOne({ userId, productId });
    if (existingCartItem) {
      // ✅ Do NOT increment quantity, just return success
      return res.json({ success: true, message: "Product already in cart" });
    } else {
      await CartItem.create({ userId, productId, quantity: 1 });
      return res.json({ success: true, message: "Product added to cart" });
    }

  } catch (err: any) {
    console.error("Error adding to cart:", err);
    res.status(500).json({ success: false, message: "Failed to add to cart", error: err.message });
  }
});


// -------------------
// POST /api/cart/update
// Update quantity of a cart item
// -------------------
app.post("/api/cart/update", authMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { productId, quantity } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    const cartItem = await CartItem.findOne({ userId, productId });
    if (!cartItem) return res.status(404).json({ success: false, message: "Cart item not found" });

    cartItem.quantity = Math.max(1, quantity);
    await cartItem.save();

    res.json({ success: true, message: "Cart updated" });
  } catch (err: any) {
    console.error("Error updating cart:", err);
    res.status(500).json({ success: false, message: "Failed to update cart", error: err.message });
  }
});

// -------------------
// POST /api/cart/remove
// Remove a product from cart
// -------------------
app.post("/api/cart/remove", authMiddleware(), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { productId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }

    await CartItem.deleteOne({ userId, productId });

    res.json({ success: true, message: "Product removed from cart" });
  } catch (err: any) {
    console.error("Error removing cart item:", err);
    res.status(500).json({ success: false, message: "Failed to remove cart item", error: err.message });
  }
});


// ------------------------
// GET /api/banners
// Fetch all banners (ordered by newest first)
// ------------------------
app.get("/api/banners", async (req, res) => {
  try {
    const banners = await Banner.find().sort({ createdAt: -1 });
    res.json({ success: true, data: banners });
  } catch (err: any) {
    console.error("Error fetching banners:", err);
    res.status(500).json({ success: false, message: "Failed to fetch banners", error: err.message });
  }
});

// ------------------------
// POST /api/banners
// Admin only
// ------------------------
app.post(
  "/api/banners",
  authMiddleware(["admin", "super-admin"]),
  async (req: AuthRequest, res: Response) => {
    try {
      const { imageUrl, position } = req.body;

      if (!imageUrl || !position) {
        return res.status(400).json({
          success: false,
          message: "imageUrl and position are required",
        });
      }

      const newBanner = await Banner.create({
        imageUrl,
        position,
        userId: req.user?.id ?? null, // ✅ trusted from token
      });

      res.status(201).json({ success: true, data: newBanner });
    } catch (err: any) {
      console.error("Error creating banner:", err);
      res.status(500).json({
        success: false,
        message: "Failed to create banner",
        error: err.message,
      });
    }
  }
);

// ------------------------
// GET /api/banners/:id
// Fetch single banner by ID
// ------------------------
app.get("/api/banners/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid banner ID" });
    }

    const banner = await Banner.findById(id);
    if (!banner) return res.status(404).json({ success: false, message: "Banner not found" });

    res.json({ success: true, data: banner });
  } catch (err: any) {
    console.error("Error fetching banner:", err);
    res.status(500).json({ success: false, message: "Failed to fetch banner", error: err.message });
  }
});

// ------------------------
// PUT /api/banners/:id
// Update banner
// ------------------------
app.put("/api/banners/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { imageUrl, position } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid banner ID" });
    }

    const updatedBanner = await Banner.findByIdAndUpdate(
      id,
      { ...(imageUrl && { imageUrl }), ...(position && { position }) },
      { new: true }
    );

    if (!updatedBanner) return res.status(404).json({ success: false, message: "Banner not found" });

    res.json({ success: true, data: updatedBanner });
  } catch (err: any) {
    console.error("Error updating banner:", err);
    res.status(500).json({ success: false, message: "Failed to update banner", error: err.message });
  }
});

// ------------------------
// DELETE /api/banners/:id
// Delete banner
// ------------------------
// ------------------------
// DELETE /api/banners/:id
// Admin | Super-Admin only
// ------------------------
app.delete(
  "/api/banners/:id",
  authMiddleware(["admin", "super-admin"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid banner ID" });
      }

      const deletedBanner = await Banner.findByIdAndDelete(id);

      if (!deletedBanner) {
        return res
          .status(404)
          .json({ success: false, message: "Banner not found" });
      }

      res.json({
        success: true,
        message: "Banner deleted successfully",
      });
    } catch (err: any) {
      console.error("Error deleting banner:", err);
      res.status(500).json({
        success: false,
        message: "Failed to delete banner",
        error: err.message,
      });
    }
  }
);

// -------- GET ALL USERS --------
app.get(
  "/api/admin/users",
  authMiddleware(["admin", "super-admin"]),
  async (req, res) => {
    try {
      const users = await User.find({}, "-password").sort({ createdAt: -1 });
      res.json({ success: true, data: users });
    } catch (err) {
      console.error("Fetch users error:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to fetch users" });
    }
  }
);


// -------- UPDATE USER ROLE --------
app.patch(
  "/api/admin/users/:id/role",
  authMiddleware(["admin", "super-admin"]),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { role } = req.body;

      if (!role || !["user", "admin", "super-admin"].includes(role)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid role" });
      }

      // ------------------------------------------------
      // STRICT ROLE HIERARCHY
      // admin ❌ cannot assign super-admin
      // ------------------------------------------------
      if (req.user?.role === "admin" && role === "super-admin") {
        return res.status(403).json({
          success: false,
          message: "Only super-admin can assign super-admin role",
        });
      }

      const updatedUser = await User.findByIdAndUpdate(
        id,
        { role },
        { new: true, select: "-password" }
      );

      if (!updatedUser) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      res.json({ success: true, data: updatedUser });
    } catch (err) {
      console.error("Role update error:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to update role" });
    }
  }
);




// ---------------- PUT /api/users/:id ---------------- //
app.options("/api/users/:id", cors()); // Required for PUT preflight

app.put(
  "/api/users/:id",
  cors(),
  authMiddleware(),
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      let { name, email, phone } = req.body;

      // ===== AUTHORIZATION: Only self or admin/super-admin =====
      const requesterId = req.user?.id;
      const requesterRole = req.user?.role;

      const isOwner = requesterId === id;
      const isAdmin = ["admin", "super-admin"].includes(requesterRole || "");

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to update this user",
        });
      }

      // ===== REQUIRE FULL FIELDS FOR PUT =====
      if (!name || (!email && !phone)) {
        return res.status(400).json({
          success: false,
          message: "PUT requires full replacement: name and email/phone must be provided",
        });
      }

      // ===== NORMALIZE PHONE IF PROVIDED =====
      if (phone) {
        let p = phone.toString().replace(/\D/g, "");
        if (p.startsWith("07")) p = "254" + p.substring(1);
        if (p.startsWith("7") && p.length === 9) p = "254" + p;
        phone = p;
      }

      // ===== CLEAN EMAIL =====
      if (email) {
        email = email.toLowerCase().trim();
      }

      // ===== DO NOT ALLOW ROLE/PASSWORD OVERRIDE =====
      // Fields that MUST NOT be modified via PUT
      const protectedFields = ["password", "role", "_id", "createdAt"];

      protectedFields.forEach((field) => {
        if (req.body[field]) delete req.body[field];
      });

      // Build the final update object
      const updateObject = {
        name,
        email: email || null,
        phone: phone || null,
      };

      // ===== UPDATE USER =====
      const updatedUser = await User.findByIdAndUpdate(id, updateObject, {
        new: true,
        runValidators: true,
      }).select("-password");

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.json({
        success: true,
        message: "User updated successfully",
        user: updatedUser,
      });

    } catch (err) {
      console.error("PUT USER ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }
);

// ------------------- DASHBOARD SUMMARY -------------------
app.get(
  "/api/admin/summary",
  authMiddleware(["admin", "super-admin"]),
  async (req, res) => {
    try {
      const timeframe = req.query.timeframe || "week";

      let startDate = new Date();
      if (timeframe === "day") startDate.setDate(startDate.getDate() - 1);
      else if (timeframe === "week") startDate.setDate(startDate.getDate() - 7);
      else if (timeframe === "month") startDate.setMonth(startDate.getMonth() - 1);

      const usersCount = await User.countDocuments();
      const ordersCount = await Order.countDocuments();
      const productsCount = await Product.countDocuments();

      const revenueAgg = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate },
            paymentStatus: PaymentStatus.CONFIRMED,
          },
        },
        { $group: { _id: null, total: { $sum: "$totalAmount" } } },
      ]);

      const revenue = revenueAgg[0]?.total || 0;

      const recentOrders = await Order.find()
        .sort({ createdAt: -1 })
        .limit(10)
        .select("fullName email totalAmount paymentStatus createdAt");

      const salesDataRaw = await Order.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate },
            paymentStatus: PaymentStatus.CONFIRMED,
          },
        },
        {
          $group: {
            _id: {
              year: { $year: "$createdAt" },
              month: { $month: "$createdAt" },
              day: { $dayOfMonth: "$createdAt" },
            },
            revenue: { $sum: "$totalAmount" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]);

      const salesData = salesDataRaw.map((d) => ({
        date: `${d._id.day}/${d._id.month}/${d._id.year}`,
        revenue: d.revenue,
      }));

      res.json({
        success: true,
        stats: {
          users: usersCount,
          orders: ordersCount,
          revenue,
          products: productsCount,
        },
        recentOrders,
        salesData,
      });
    } catch (err) {
      console.error(err);
      res
        .status(500)
        .json({ success: false, message: "Failed to fetch dashboard summary" });
    }
  }
);


/**
 * Revenue endpoint
 * Query params: ?range=daily|weekly|monthly|all
 */
app.get(
  "/api/admin/revenue",
  authMiddleware(["admin", "super-admin"]),
  async (req, res) => {
    try {
      const range = (req.query.range as string) || "all";
      let match: any = { paymentStatus: "CONFIRMED" };

      const now = new Date();
      if (range === "daily") {
        match.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
      } else if (range === "weekly") {
        const start = new Date();
        start.setDate(now.getDate() - 7);
        match.createdAt = { $gte: start };
      } else if (range === "monthly") {
        match.createdAt = { $gte: new Date(now.getFullYear(), now.getMonth(), 1) };
      }

      const orders = await Order.find(match)
        .populate({
          path: "productDetails",
          populate: { path: "productId", model: "Product" },
        })
        .sort({ createdAt: -1 });

      let totalRevenue = 0;
      const chartMap: Record<string, number> = {};

      orders.forEach((order) => {
        totalRevenue += order.totalAmount;
        const d = new Date(order.createdAt);
        const key =
          range === "daily"
            ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString();

        chartMap[key] = (chartMap[key] || 0) + order.totalAmount;
      });

      const chartData = Object.keys(chartMap)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
        .map((date) => ({ date, revenue: chartMap[date] }));

      res.json({
        success: true,
        totalRevenue,
        orders: orders.map((o) => ({
          id: o._id,
          fullName: o.fullName,
          totalAmount: o.totalAmount,
          paymentMethod: o.paymentMethod,
          shippingStage: o.shippingStage,
          createdAt: o.createdAt,
        })),
        chartData,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);


// Get paginated orders with optional shipping filter
app.get(
  "/api/admin/orders",
  authMiddleware(["admin", "super-admin"]),
  async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const shipping = req.query.shipping as string;

      const query: any = {};
      if (shipping) query.shippingStage = shipping;

      const totalOrders = await Order.countDocuments(query);
      const totalPages = Math.ceil(totalOrders / limit);

      const orders = await Order.find(query)
        .populate({
          path: "productDetails",
          populate: { path: "productId", model: "Product" },
        })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      const mappedOrders = orders.map((o) => ({
        id: o._id,
        fullName: o.fullName,
        totalAmount: o.totalAmount,
        shippingStage: o.shippingStage,
        createdAt: o.createdAt,
        address: o.address,
        city: o.city,
        county: o.county,
        phone: o.phone,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        productDetails: o.productDetails.map((op: any) => ({
          id: op._id,
          quantity: op.quantity,
          product: {
            id: op.productId._id,
            productName: op.productId.productName,
            sellingPrice: op.productId.sellingPrice,
            productImage: op.productId.productImage,
          },
        })),
      }));

      res.json({
        success: true,
        allOrders: mappedOrders,
        confirmedOrders: mappedOrders.filter(
          (o) => o.paymentStatus === "CONFIRMED"
        ),
        totalPages,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);


// Update order shipping stage
app.patch(
  "/api/admin/orders/:id/shipping",
  authMiddleware(["admin", "super-admin"]),
  async (req, res) => {
    try {
      const { shippingStage } = req.body;

      const order = await Order.findByIdAndUpdate(
        req.params.id,
        { shippingStage },
        { new: true }
      );

      if (!order) {
        return res
          .status(404)
          .json({ success: false, message: "Order not found" });
      }

      res.json({ success: true, order });
    } catch (err) {
      res.status(500).json({ success: false, message: "Server error" });
    }
  }
);


// ----------------------
// CHECKOUT ROUTE
// ----------------------
app.post("/api/checkout", async (req, res) => {
  try {
    const {
      userId,
      phoneNumber,
      amount,
      accountReference,
      description,
      fullName,
      address,
      county,
      city,
      productDetails,
    } = req.body;

    if (
      !userId ||
      !phoneNumber ||
      !amount ||
      !accountReference ||
      !description ||
      !fullName ||
      !address ||
      !county ||
      !city ||
      !productDetails?.length
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Trigger M-Pesa STK push
    const stkResponse = await initiateMpesaStkPush({
      userId,
      phoneNumber,
      amount,
      accountReference,
      description,
      fullName,
      address,
      county,
      city,
      productDetails,
    });

    res.json({ success: true, data: stkResponse });
  } catch (err) {
    console.error("Checkout error:", err);
    res.status(500).json({ error: "Failed to initiate checkout", details: (err as Error).message });
  }
});

// ----------------------
// WEBHOOK ROUTE
// ----------------------
app.post("/api/webhook", async (req, res) => {
  try {
    const { Body } = req.body;
    const callback = Body?.stkCallback;
    if (!callback) return res.status(400).send("No callback data");

    const checkoutRequestId = callback.CheckoutRequestID;

    if (callback.ResultCode !== 0) {
      console.log(`Payment failed for ${checkoutRequestId}, ignoring.`);
      return res.json({ success: true, message: "Payment failed ignored" });
    }

    // Retrieve pending order from Redis
    const pendingOrderStr = await redis.get(`pending_order:${checkoutRequestId}`);
    if (!pendingOrderStr) return res.status(404).send("Pending order not found");

    const pendingOrder = JSON.parse(pendingOrderStr);
    const { userId, fullName, phone, address, county, city, totalAmount, productDetails } = pendingOrder;

    // 1️⃣ Create MongoDB order
    const order = await Order.create({
      userId,
      fullName,
      phone,
      address,
      county,
      city,
      totalAmount,
      paymentStatus: "CONFIRMED",
      paymentMethod: ["MPESA"],
      mpesaCheckoutRequestId: checkoutRequestId,
      mpesaReceiptNumber: callback.CallbackMetadata.Item.find((i: any) => i.Name === "MpesaReceiptNumber")?.Value,
      mpesaPhoneNumber: callback.CallbackMetadata.Item.find((i: any) => i.Name === "PhoneNumber")?.Value,
      productDetails: [],
    });

    // 2️⃣ Create OrderProduct entries AND update stock
    for (const item of productDetails) {
      const op = await OrderProduct.create({
        orderId: order._id as mongoose.Types.ObjectId,
        productId: item.productId,
        quantity: item.quantity,
      });

      order.productDetails.push(op._id as mongoose.Types.ObjectId);

      // Decrease stock
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stock: -item.quantity },
      });
    }

    await order.save();

    // 3️⃣ Clear user's cart
    await CartItem.deleteMany({ userId });

    // 4️⃣ Delete Redis key
    await redis.del(`pending_order:${checkoutRequestId}`);

    res.json({ success: true });
  } catch (err) {
    console.error("Webhook error:", err);
    res.status(500).send("Server error");
  }
});



/**
 * Query payment status by checkoutRequestId
 * Frontend will poll this endpoint every few seconds
 */
app.get("/api/orders/status", async (req, res) => {
  try {
    const { checkoutRequestId } = req.query;
    if (!checkoutRequestId) return res.status(400).json({ error: "Missing checkoutRequestId" });

    // 1️⃣ Check Redis for pending order
    const pendingOrderStr = await redis.get(`pending_order:${checkoutRequestId}`);
    if (pendingOrderStr) {
      return res.json({ paymentStatus: "PENDING" });
    }

    // 2️⃣ Check if order has been created in MongoDB
    const order = await Order.findOne({ mpesaCheckoutRequestId: checkoutRequestId })
      .populate("productDetails"); // optional: populate products if needed

    if (order) {
      return res.json({
        paymentStatus: order.paymentStatus,
        _id: order._id,
      });
    }

    // 3️⃣ If not in Redis or MongoDB
    return res.status(404).json({ error: "Order not found" });
  } catch (err) {
    console.error("Error fetching payment status:", err);
    res.status(500).json({ error: "Server error" });
  }
});


// ----------------------
// GET ORDER BY ID
// ----------------------
app.get("/api/orders/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findOne({ mpesaCheckoutRequestId: orderId })
      .populate({
        path: "productDetails",
        populate: { path: "productId", model: Product },
      })
      .lean();

    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    res.json(order);
  } catch (err) {
    console.error("Get order error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});



// ---------------------------
// ORDER ROUTES
// ---------------------------

// Create a new order
app.post("/api/orders", async (req: Request, res: Response) => {
  try {
    const { userId, productDetails, paymentMethod, totalAmount } = req.body;

    if (!userId || !productDetails || !totalAmount)
      return res.status(400).json({ message: "Missing required fields" });

    const orderProducts: mongoose.Types.ObjectId[] = [];

    for (const item of productDetails) {
  const orderProduct = new OrderProduct({
    productId: item.productId,
    quantity: item.quantity,
  });
  await orderProduct.save();
  // ✅ Cast _id to ObjectId
  orderProducts.push(orderProduct._id as mongoose.Types.ObjectId);
}

    const order = new Order({
      userId,
      productDetails: orderProducts,
      paymentMethod,
      totalAmount,
      paymentStatus: PaymentStatus.PENDING,
      shippingStage: ShippingStage.PENDING,
    });

    await order.save();
    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to create order" });
  }
});

// Get all orders for a user
app.get("/api/orders/user/:userId", async (req: Request, res: Response) => {
  try {
    const orders = await Order.find({ userId: req.params.userId }).populate({
      path: "productDetails",
      populate: { path: "productId", model: Product },
    });
    res.json({ success: true, orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to fetch orders" });
  }
});

// Generate PDF receipt for an order
app.get("/api/orders/:id/receipt", async (req: Request, res: Response) => {
  try {
    // Find order and populate user and products
    const order = await Order.findById(req.params.id)
      .populate({ path: "productDetails", populate: { path: "productId" } })
      .populate("userId");

    if (!order) return res.status(404).json({ message: "Order not found" });

    // Cast populated fields to proper types
    const user = order.userId as unknown as IUser;
    const orderProducts = order.productDetails as unknown as (IOrderProduct & { productId: any })[];

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([600, 750]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = 700;
    page.drawText("RECEIPT", { x: 240, y, size: 26, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
    y -= 50;

    // --- Order Info ---
    page.drawText(`Order ID: ${order._id}`, { x: 50, y, size: 12, font });
    y -= 20;
    page.drawText(`Customer: ${user.name}`, { x: 50, y, size: 12, font });
    y -= 20;
    page.drawText(`Email: ${user.email}`, { x: 50, y, size: 12, font });
    y -= 20;
    page.drawText(`Total: KES ${order.totalAmount}`, { x: 50, y, size: 12, font });
    y -= 30;

    // --- Table Header ---
    const tableX = 50;
    const tableWidth = 500;
    const colWidths = [300, 80, 120]; // Product, Qty, Price
    const headerHeight = 30;

    page.drawRectangle({
      x: tableX,
      y: y - headerHeight + 5,
      width: tableWidth,
      height: headerHeight,
      color: rgb(0.9, 0.9, 0.9),
    });

    page.drawText("Product", { x: tableX + 10, y: y - 10, size: 12, font: boldFont });
    page.drawText("Qty", { x: tableX + colWidths[0] + 10, y: y - 10, size: 12, font: boldFont });
    page.drawText("Price", { x: tableX + colWidths[0] + colWidths[1] + 10, y: y - 10, size: 12, font: boldFont });
    y -= headerHeight + 5;

    // --- Table Rows ---
    const rowHeight = 22;
    for (const item of orderProducts) {
      const product = item.productId as any; // If you have IProduct, you can type here
      page.drawText(product.productName ?? '', { x: tableX + 10, y: y - 15, size: 11, font });
      page.drawText(String(item.quantity), { x: tableX + colWidths[0] + 10, y: y - 15, size: 11, font });
      page.drawText(`KES ${product.sellingPrice ?? product.price ?? 0}`, { x: tableX + colWidths[0] + colWidths[1] + 10, y: y - 15, size: 11, font });
      y -= rowHeight;
    }

    // --- Total Section ---
    y -= 15;
    page.drawRectangle({
      x: tableX,
      y: y - headerHeight + 5,
      width: tableWidth,
      height: headerHeight,
      color: rgb(0.95, 0.95, 0.95),
    });
    page.drawText("Total:", { x: tableX + colWidths[0] + 10, y: y - 10, size: 14, font: boldFont });
    page.drawText(`KES ${order.totalAmount}`, { x: tableX + colWidths[0] + colWidths[1] + 10, y: y - 10, size: 14, font: boldFont });

    // Save PDF
    const pdfBytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=receipt-${order._id}.pdf`);
    res.send(pdfBytes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to generate receipt" });
  }
});


// ---------------------------
// GET CUSTOMER DASHBOARD DATA
// ---------------------------
app.get("/api/dashboard/customer", authMiddleware(), async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Get all user orders
    const orders = await Order.find({ userId })
      .populate({
        path: "productDetails",
        populate: {
          path: "productId",
          model: "Product",
        },
      })
      .sort({ createdAt: -1 });

    const confirmedOrders = orders.filter(o => o.paymentStatus === "CONFIRMED");
    const totalSpent = confirmedOrders.reduce((sum, o) => sum + o.totalAmount, 0);

    const activeOrders = orders
      .filter(o => o.shippingStage !== "DELIVERED")
      .map(o => ({
        id: o._id,
        shippingStage: o.shippingStage,
        items: o.productDetails.map((p: any) => ({
          name: p.productId.productName,
          qty: p.quantity,
        })),
      }));

    const formattedOrders = orders.map((o) => ({
      id: o._id,
      createdAt: o.createdAt,
      totalAmount: o.totalAmount,
      paymentStatus: o.paymentStatus,
      productDetails: o.productDetails.map((p: any) => ({
        id: p._id,
        quantity: p.quantity,
        product: {
          id: p.productId._id,
          productName: p.productId.productName,
        },
      })),
    }));

    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        createdAt: user.createdAt,
      },
      stats: {
        totalSpent,
        totalOrders: confirmedOrders.length,
        activeOrders: activeOrders.length,
      },
      orders: formattedOrders,
      activeOrders,
    });
  } catch (err) {
    console.error("Dashboard error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});



// ------------------------
// Contact form endpoint
// ------------------------
app.post("/api/contact", async (req: Request, res: Response) => {
  try {
    const { name, email, message } = req.body as ContactFormData;

    // Basic validation
    if (!name?.trim() || !email?.trim() || !message?.trim()) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Send branded contact email
    await sendContactEmail({ name, email, message });

    return res.status(200).json({ message: "Message sent successfully!" });
  } catch (err: any) {
    console.error("Contact form error:", err);
    return res.status(500).json({ message: "Failed to send message. Please try again later." });
  }
});


// Endpoint to get a chatbot node
app.get("/api/chatbot/:nodeId", (req, res) => {
  const nodeId = req.params.nodeId;
  const node = colltechHubChatbot[nodeId];
  if (!node) return res.status(404).json({ error: "Node not found" });
  res.json(node);
});

// Endpoint to trigger handover
app.post("/api/chatbot/handover", async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone is required" });
  try {
    const message = await handoverToAgent(phone);
    res.json({ message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to notify agent" });
  }
});

// Health / sanity
app.get("/health", (_req, res) => res.json({ status: "ok", time: Date.now() }));

// ----------------------
// Start server
// ----------------------
async function startServer() {
  await testConnections();

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

startServer();

app.get("/", (_req, res) => {
  res.send("🚀 Colltech backend is running!");
});

export default app;
