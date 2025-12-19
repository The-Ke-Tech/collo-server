// models/Cart.ts
import mongoose, { Schema, Document, Model, Types } from "mongoose";

export interface ICartItem extends Document {
  userId: Types.ObjectId;         // User who owns this cart item
  productId: Types.ObjectId;      // The product being added
  quantity: number;               // How many units
  createdAt: Date;
  updatedAt: Date;
}

const cartSchema = new Schema<ICartItem>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, default: 1 },
  },
  { timestamps: true }
);

// Ensure a user can have only one entry per product
cartSchema.index({ userId: 1, productId: 1 }, { unique: true });

const CartItem: Model<ICartItem> = mongoose.models.CartItem || mongoose.model("CartItem", cartSchema);
export default CartItem;
