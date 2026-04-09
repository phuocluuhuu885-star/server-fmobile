var db = require("../config/ConnectDB");

const shipperSchema = new db.mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone_number: { type: String, required: true, trim: true },
    shipper_code: { type: String, required: true, trim: true, unique: true },
    shipping_company: { type: String, required: true, trim: true },
  },
  {
    timestamps: true,
  }
);

let shipper = db.mongoose.model("shipper", shipperSchema);
module.exports = { shipper };
