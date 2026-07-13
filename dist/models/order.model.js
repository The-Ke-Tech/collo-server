"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderSource = exports.PaymentStatus = exports.ShippingStage = void 0;
const mongoose_1 = __importStar(require("mongoose"));
var ShippingStage;
(function (ShippingStage) {
    ShippingStage["PENDING"] = "PENDING";
    ShippingStage["PACKING"] = "PACKING";
    ShippingStage["SHIPPED"] = "SHIPPED";
    ShippingStage["IN_TRANSIT"] = "IN_TRANSIT";
    ShippingStage["DELIVERED"] = "DELIVERED";
    ShippingStage["CANCELLED"] = "CANCELLED";
})(ShippingStage || (exports.ShippingStage = ShippingStage = {}));
var PaymentStatus;
(function (PaymentStatus) {
    PaymentStatus["PENDING"] = "PENDING";
    PaymentStatus["CONFIRMED"] = "CONFIRMED";
    PaymentStatus["FAILED"] = "FAILED";
})(PaymentStatus || (exports.PaymentStatus = PaymentStatus = {}));
var OrderSource;
(function (OrderSource) {
    OrderSource["POS"] = "POS";
    OrderSource["ONLINE"] = "ONLINE";
})(OrderSource || (exports.OrderSource = OrderSource = {}));
const orderSchema = new mongoose_1.Schema({
    userId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    email: {
        type: String,
    },
    productDetails: [
        {
            type: mongoose_1.Schema.Types.ObjectId,
            ref: "OrderProduct",
        },
    ],
    paymentMethod: {
        type: [String],
        default: [],
    },
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
    source: {
        type: String,
        enum: Object.values(OrderSource),
        default: OrderSource.ONLINE,
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
}, {
    timestamps: true,
});
const Order = mongoose_1.default.models.Order ||
    mongoose_1.default.model("Order", orderSchema);
exports.default = Order;
