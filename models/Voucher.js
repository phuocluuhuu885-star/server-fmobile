const db = require("../config/ConnectDB");

const voucherSchema = new db.mongoose.Schema(
	{
		code: { type: String, required: true, unique: true },
		title: { type: String, required: true },
		discountType: { type: Number, default: 1 }, // 1: %, 2: Tiền mặt Hình thức giảm giá.
		discountValue: { type: Number, required: true }, //Giá trị cụ thể của mức giảm.

		// Mảng chứa các ID sản phẩm được áp dụng mã này
		// Nếu mảng rỗng [] => Áp dụng cho TẤT CẢ sản phẩm
		applicableProducts: [{ type: db.mongoose.Schema.Types.String, ref: "product" }],

		minOrderValue: { type: Number, default: 0 }, //Giá trị đơn hàng tối thiểu để kích hoạt voucher.
		maxDiscountValue: { type: Number }, //Số tiền giảm tối đa (thường dùng cho loại giảm %).
		quantity: { type: Number, default: 0 }, //Tổng số lượt mã có thể sử dụng
		expiryDate: { type: Date, required: true }, //Ngày hết hạn của voucher
		status: { type: Number, default: 1 }, //Trạng thái hoạt động của mã
	},
	{ timestamps: true },
);

let voucher = db.mongoose.model("voucher", voucherSchema);
module.exports = {
	voucher,
};
