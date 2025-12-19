import mongoose, { Schema, Document, Model } from "mongoose";

export interface IOrderProduct extends Document {
  orderId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

const orderProductSchema = new Schema<IOrderProduct>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true },
  },
  { timestamps: true }
);

const OrderProduct: Model<IOrderProduct> =
  mongoose.models.OrderProduct || mongoose.model("OrderProduct", orderProductSchema);

export default OrderProduct;
