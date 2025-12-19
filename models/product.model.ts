import mongoose, { Schema, Document, Model } from "mongoose";

export interface IProduct extends Document {
  productName: string;
  slug: string;              // 🔹 added slug
  brandName?: string;
  category?: string;
  productImage: string[];
  description?: string;
  price?: number;
  sellingPrice?: number;
  stock: number;
  createdBy: mongoose.Types.ObjectId; // reference to User
  createdAt: Date;
  updatedAt: Date;
}

const productSchema: Schema<IProduct> = new Schema(
  {
    productName: { type: String, required: true },
    slug: { type: String, required: true, unique: true }, // 🔹 slug field
    brandName: { type: String },
    category: { type: String },
    productImage: { type: [String], default: [] },
    description: { type: String },
    price: { type: Number },
    sellingPrice: { type: Number },
    stock: { type: Number, default: 0 },

    // reference to the user who uploaded the product
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

const Product: Model<IProduct> =
  mongoose.models.Product || mongoose.model<IProduct>("Product", productSchema);

export default Product;
