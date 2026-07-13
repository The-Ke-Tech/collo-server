import mongoose, {
  Schema,
  Document,
  Model,
  Types,
} from "mongoose";

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

export enum OrderSource {
  POS = "POS",
  ONLINE = "ONLINE",
}

export interface IOrder
  extends Document {
  userId: Types.ObjectId;

  email?: string;

  productDetails: Types.ObjectId[];

  paymentMethod: string[];

  paymentStatus: PaymentStatus;

  shippingStage: ShippingStage;

  source: OrderSource;

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

const orderSchema =
  new Schema<IOrder>(
    {
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },

      email: {
        type: String,
      },

      productDetails: [
        {
          type: Schema.Types.ObjectId,
          ref: "OrderProduct",
        },
      ],

      paymentMethod: {
        type: [String],
        default: [],
      },

      paymentStatus: {
        type: String,
        enum: Object.values(
          PaymentStatus
        ),
        default:
          PaymentStatus.PENDING,
      },

      shippingStage: {
        type: String,
        enum: Object.values(
          ShippingStage
        ),
        default:
          ShippingStage.PENDING,
      },

      source: {
        type: String,
        enum: Object.values(
          OrderSource
        ),
        default:
          OrderSource.ONLINE,
      },

      totalAmount: {
        type: Number,
        default: 0,
      },

      fullName: {
        type: String,
      },

      phone: {
        type: String,
      },

      address: {
        type: String,
      },

      county: {
        type: String,
      },

      city: {
        type: String,
      },

      mpesaCheckoutRequestId: {
        type: String,
        unique: true,
        sparse: true,
      },

      mpesaReceiptNumber: {
        type: String,
      },

      mpesaPhoneNumber: {
        type: String,
      },
    },

    {
      timestamps: true,
    }
  );

const Order: Model<IOrder> =
  mongoose.models.Order ||
  mongoose.model<IOrder>(
    "Order",
    orderSchema
  );

export default Order;