// models/Banner.ts
import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBanner extends Document {
  imageUrl: string;
  position: "left" | "right";
  createdAt: Date;
  userId?: mongoose.Types.ObjectId; // reference to User (optional)
}

const bannerSchema: Schema<IBanner> = new Schema(
  {
    imageUrl: { type: String, required: true },
    position: { type: String, enum: ["left", "right"], required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } } // only createdAt
);

const Banner: Model<IBanner> = mongoose.models.Banner || mongoose.model<IBanner>("Banner", bannerSchema);

export default Banner;
