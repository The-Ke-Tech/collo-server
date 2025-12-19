// middleware/auth.ts
import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET!;

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

interface JwtPayload {
  id: string;
  role: string;
}

export const authMiddleware = (allowedRoles?: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.log("[AuthMiddleware] No token provided");
        return res.status(401).json({ message: "No token provided" });
      }

      const token = authHeader.split(" ")[1];
      console.log("[AuthMiddleware] token:", token);

      const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
      console.log("[AuthMiddleware] decoded:", decoded);

      if (allowedRoles && !allowedRoles.includes(decoded.role.toLowerCase())) {
        return res.status(403).json({ message: "Forbidden" });
      }


      req.user = { id: decoded.id, role: decoded.role };
      next();
    } catch (err: any) {
      console.log("[AuthMiddleware] JWT error:", err.message);
      return res.status(401).json({ message: "Unauthorized" });
    }
  };
};


