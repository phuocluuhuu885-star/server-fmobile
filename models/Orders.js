var db = require("../config/ConnectDB");

const orderSchema = new db.mongoose.Schema(
  {
    user_id: { type: db.mongoose.Schema.Types.ObjectId, ref: "account" },
                      
    productsOrder: [
      {
        option_id: { type: db.mongoose.Schema.Types.ObjectId, ref: "option" },
        quantity: { type: Number },
        discount_value: { type: Number},
        custom_name: { type: String, default: "" },
        custom_price: { type: Number, default: 0 },
      },
    ],
    total_price: { type: Number }, //tổng tiền tất cả mặt hàng
    status: {
      type: String,
      enum: ["Chờ thanh toán", "Chờ xác nhận", "Chờ giao hàng","Đang giao hàng", "Đã giao hàng", "Đã hủy"],
      default: "Chờ xác nhận",
    },
    reason: { type: String, default: "" },
    info_id: {
      type: db.mongoose.Schema.Types.ObjectId,
      ref: "info",  
      required: true,
    },
    payment_status: { type: Boolean, default: false }, // false = chưa thanh toán
    payment_method: { type: Number, default: 1 },    // 1: COD, 2: ZaloPay
    app_trans_id: { type: String, unique: true, sparse: true }, // Mã đối soát ZaloPay // false = chưa thanh toán
    admin_update_logs: [
      {
        updated_by: { type: String },         // Tên admin thực hiện
        action: { type: String },             // Hành động
        details: { type: String },            // Chi tiết thay đổi
        note: { type: String, default: "" },  // Ghi chú admin
        duration_minutes: { type: Number, default: 0 },
        from_time: { type: Date },
        to_time: { type: Date, default: Date.now }
      }
    ]
  },
  
  {
    timestamps: true,
  }
);

let order = db.mongoose.model("order", orderSchema);
module.exports = { order };
