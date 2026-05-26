var db = require("../config/ConnectDB");

const withdrawalSchema = new db.mongoose.Schema(
  {
    user_id: { type: db.mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    name: { type: String, required: true }, // Họ tên chủ tài khoản nhận tiền
    bank: { type: String, required: true }, // Tên ngân hàng (e.g. Vietcombank)
    bank_code: { type: String, required: true }, // Mã VietQR ngân hàng (e.g. vietcombank)
    account_number: { type: String, required: true }, // Số tài khoản ngân hàng
    amount: { type: Number, required: true, min: 1000 }, // Số tiền rút (tối thiểu 1,000đ)
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    bill_image: { type: String }, // Link ảnh hóa đơn chuyển khoản (khi approved)
    rejection_reason: { type: String }, // Lý do từ chối (khi rejected)
    processed_by: { type: db.mongoose.Schema.Types.ObjectId, ref: "account" }, // Admin xử lý
    processed_at: { type: Date }
  },
  {
    timestamps: true,
  }
);

let Withdrawal = db.mongoose.models.Withdrawal || db.mongoose.model("Withdrawal", withdrawalSchema);
module.exports = Withdrawal;
