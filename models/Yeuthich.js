const db = require("../config/ConnectDB");

const mongoose = db.mongoose;

const yeuthichSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: "account" },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: "products" },
});

const Yeuthich = mongoose.model("Yeuthich", yeuthichSchema);

module.exports = Yeuthich;