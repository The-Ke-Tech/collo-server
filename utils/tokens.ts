// utils/jwt.ts
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;

export const generateAccessToken = (payload: any) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "40m" });
};

export const generateRefreshToken = (payload: any) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
};
