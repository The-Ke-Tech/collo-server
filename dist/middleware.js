"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET;
const authMiddleware = (allowedRoles) => {
    return (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith("Bearer ")) {
                console.log("[AuthMiddleware] No token provided");
                return res.status(401).json({ message: "No token provided" });
            }
            const token = authHeader.split(" ")[1];
            console.log("[AuthMiddleware] token:", token);
            const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
            console.log("[AuthMiddleware] decoded:", decoded);
            if (allowedRoles && !allowedRoles.includes(decoded.role.toLowerCase())) {
                return res.status(403).json({ message: "Forbidden" });
            }
            req.user = { id: decoded.id, role: decoded.role };
            next();
        }
        catch (err) {
            console.log("[AuthMiddleware] JWT error:", err.message);
            return res.status(401).json({ message: "Unauthorized" });
        }
    };
};
exports.authMiddleware = authMiddleware;
