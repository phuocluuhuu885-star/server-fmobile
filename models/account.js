const db = require("../config/ConnectDB");

const accountSchema = new db.mongoose.Schema(
  {
    email: { type: String, required: true },
    password: { type: String, required: true },
    fcmToken: { type: String },
    avatar: { type: String },
    username: { type: String },
    full_name: { type: String },
    birthday: { type: String },
    token: { type: String },
    isVerify: { type: Boolean, default: false },
    confirmationCode: { type: String },
    confirmationExpiration: { type: Date },
    is_active: { type: Boolean, default: true },
    role_id: {
      type: String,
      enum: ["admin", "customer", "staff"],
      default: "customer",
    },
    trust_score: { type: Number, default: 150, min: 0 },
    is_blacklisted: { type: Boolean, default: false },
    restrict_buy: { type: Boolean, default: false },
    wallet_balance: { type: Number, default: 0, min: 0 },
    admin_logs: [
      {
        updated_by: { type: String },         // Tên admin thực hiện
        action: { type: String },             // Hành động thực hiện
        reason: { type: String, default: "" }, // Lý do thực hiện
        to_time: { type: Date, default: Date.now } // Thời điểm thực hiện
      }
    ],
  },
  {
    timestamps: true,
  }
);

let account = db.mongoose.models.account || db.mongoose.model("account", accountSchema);
module.exports = {
  account,
};
