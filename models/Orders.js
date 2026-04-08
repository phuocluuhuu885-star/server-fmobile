var db = require("../config/ConnectDB");

const orderSchema = new db.mongoose.Schema(
  {
    user_id: { type: db.mongoose.Schema.Types.ObjectId, ref: "account" },
    productsOrder: [
      {
        option_id: { type: db.mongoose.Schema.Types.ObjectId, ref: "option" },
        quantity: { type: Number },
        discount_value: { type: Number},
      },
    ],
    total_price: { type: Number }, //tổng tiền tất cả mặt hàng
    status: {
      type: String,
      enum: ["Chờ xác nhận", "Chờ giao hàng","Đang giao hàng", "Đã giao hàng", "Đã hủy"],
      default: "Chờ xác nhận",
    },
    info_id: {
      type: db.mongoose.Schema.Types.ObjectId,
      ref: "info",  
      required: true,
    },
    payment_status: { type: Boolean, default: false }, // false = chưa thanh toán
    payment_method: { type: Number, default: 1 },    // 1: COD, 2: ZaloPay
    app_trans_id: { type: String, unique: true, sparse: true } // Mã đối soát ZaloPay // false = chưa thanh toán

  },
  
  {
    timestamps: true,
  }
);

let order = db.mongoose.model("order", orderSchema);
module.exports = { order };
