var db = require("../config/ConnectDB");

const productSchema = new db.mongoose.Schema(
  {
    // store_id: {
    //   type: db.mongoose.Schema.Types.ObjectId,
    //   ref: "store",
    //   required: true,
    // },
    category_id: {
      type: db.mongoose.Schema.Types.ObjectId,
      ref: "category",
      required: true,
    },
    name: { type: String },
    images: [{ type: String }],
    description: { type: String },
    status: { type: String, required: true, enum: ["mới", "cũ"] }, //mới, cũ
    condition_percent: { type: String, enum: ["99", "98", "95", "100", ""] }, // phần trăm độ mới
    battery_health: { type: String }, // tình trạng pin (%)
    is_original: { type: String, enum: ["Zin nguyên bản", "Đã thay linh kiện", ""] }, // zin hay thay
    warranty_time: { type: String, enum: ["1 tháng", "3 tháng", "6 tháng", "12 tháng", ""] }, // cam kết bảo hành
    discounted: { type: Boolean, default: false }, //có giảm giá hay không
    is_active: { type: Boolean },
    screen: { type: String },
    camera: { type: String },
    chipset: { type: String },
    cpu: { type: String },
    gpu: { type: String },
    ram: { type: Number },
    rom: { type: Number },
    operatingSystem: { type: String },
    battery: { type: String },
    weight: { type: Number },
    connection: { type: String },
    specialFeature: { type: String },
    manufacturer: { type: String },
    other: { type: String },
    option: [{ type: db.mongoose.Schema.Types.ObjectId, ref: "option" }],
    product_review: [
      { type: db.mongoose.Schema.Types.ObjectId, ref: "productRate" },
    ],
  },
  {
    timestamps: true,
  }
);

let product = db.mongoose.model("product", productSchema);
module.exports = { product };
