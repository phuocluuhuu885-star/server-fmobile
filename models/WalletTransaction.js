const db = require("../config/ConnectDB");

const walletTransactionSchema = new db.mongoose.Schema(
  {
    user_id: { type: db.mongoose.Schema.Types.ObjectId, ref: "account", required: true },
    type: { type: String, enum: ["deposit", "payment", "refund", "withdraw"], required: true },
    amount: { type: Number, required: true },
    description: { type: String },
    order_id: { type: db.mongoose.Schema.Types.ObjectId, ref: "order" },
    withdrawal_id: { type: db.mongoose.Schema.Types.ObjectId, ref: "Withdrawal" },
    trans_id: { type: String }
  },
  {
    timestamps: true,
  }
);

let walletTransaction = db.mongoose.models.walletTransaction || db.mongoose.model("walletTransaction", walletTransactionSchema);
module.exports = {
  walletTransaction,
};
