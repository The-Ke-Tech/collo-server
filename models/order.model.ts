// models/Order.ts
import mongoose, { Schema, Document, Model, Types } from "mongoose";

export enum ShippingStage {
  PENDING = "PENDING",
  PACKING = "PACKING",
  SHIPPED = "SHIPPED",
  IN_TRANSIT = "IN_TRANSIT",
  DELIVERED = "DELIVERED",
  CANCELLED = "CANCELLED",
}

export enum PaymentStatus {
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  FAILED = "FAILED",
}

// Interface for Order document
export interface IOrder extends Document {
  userId: Types.ObjectId; // <-- ObjectId reference to User
  email?: string;
  productDetails: Types.ObjectId[]; // <-- Array of ObjectId references to OrderProduct
  paymentMethod: string[];
  paymentStatus: PaymentStatus;
  shippingStage: ShippingStage;
  totalAmount: number;

  fullName?: string;
  phone?: string;
  address?: string;
  county?: string;
  city?: string;

  mpesaCheckoutRequestId?: string;
  mpesaReceiptNumber?: string;
  mpesaPhoneNumber?: string;

  createdAt: Date;
  updatedAt: Date;
}

// Schema definition
const orderSchema = new Schema<IOrder>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    email: { type: String },

    productDetails: [{ type: Schema.Types.ObjectId, ref: "OrderProduct" }],

    paymentMethod: { type: [String], default: [] },
    paymentStatus: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
    },
    shippingStage: {
      type: String,
      enum: Object.values(ShippingStage),
      default: ShippingStage.PENDING,
    },
    totalAmount: { type: Number, default: 0 },

    fullName: { type: String },
    phone: { type: String },
    address: { type: String },
    county: { type: String },
    city: { type: String },

    mpesaCheckoutRequestId: { type: String, unique: true, sparse: true },
    mpesaReceiptNumber: { type: String },
    mpesaPhoneNumber: { type: String },
  },
  { timestamps: true }
);

// Create model
const Order: Model<IOrder> = mongoose.models.Order || mongoose.model<IOrder>("Order", orderSchema);
export default Order;
