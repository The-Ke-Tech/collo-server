import mongoose, { Schema, Document, Model } from "mongoose";

export interface IService extends Document {
  serviceName: string;
  slug: string;                // 🔹 slug for SEO/URL
  category?: string;
  serviceImage: string[];
  description?: string;
  price?: number;
  startingFrom?: boolean;      // 🔹 indicates if pricing is "starting from"
  pricingType?: string;        // 🔹 e.g., fixed, per unit, per hour
  unitLabel?: string;          // 🔹 e.g., "per hour", "per service"
  createdBy: mongoose.Types.ObjectId; // reference to User
  createdAt: Date;
  updatedAt: Date;
}

const serviceSchema: Schema<IService> = new Schema(
  {
    serviceName: { type: String, required: true },
    slug: { type: String, required: true, unique: true }, // 🔹 slug field
    category: { type: String, default: "services" },
    serviceImage: { type: [String], default: [] },
    description: { type: String },
    price: { type: Number },
    startingFrom: { type: Boolean, default: true },
    pricingType: { type: String }, // optional, can match selectedService.pricingType
    unitLabel: { type: String },   // optional, e.g., "per hour"
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

const Service: Model<IService> =
  mongoose.models.Service || mongoose.model<IService>("Service", serviceSchema);

export default Service;
