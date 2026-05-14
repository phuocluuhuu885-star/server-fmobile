var db = require("../config/ConnectDB");

const optionSchema = new db.mongoose.Schema(
  {
    product_id: { type: db.mongoose.Schema.Types.ObjectId, ref: "product" },
    name_color: { type: String },
    color_code: { type: String },
    image: { type: String },
    price: { type: Number },
    discount_value: { type: Number, default: 0 },
    quantity: { type: Number }, // số lượng của sản phẩm
    soldQuantity: { type: Number, default: 0 }, // số lượng đã bán
    hot_option: { type: Boolean, default: false }, // option tốt nổi bật nhất
    ram: { type: String }, // RAM
    storage_capacity: { type: String }, // Dung lượng (ROM)
    condition_percent: { type: String }, // Độ mới (%)
    battery_health: { type: String }, // Tình trạng pin (%)
    is_original: { type: String }, // Nguyên bản hay đã thay thế
    warranty_time: { type: String }, // Thời gian bảo hành
  },
  { timestamps: true }
);

let option = db.mongoose.models.option || db.mongoose.model("option", optionSchema);
module.exports = {
  option,
};
