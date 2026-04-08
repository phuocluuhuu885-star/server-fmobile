const models = require("../models/Voucher");

const list = async (req, res, next) => {
	try {
		const vouchers = await models.voucher.find().populate("applicableProducts");
		return res.status(200).json({ code: 200, data: vouchers, message: "get data successfully!" });
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};
const mongoose = require("mongoose");
const getVouchersForCart = async (req, res) => {
	try {
		const { productIds } = req.body;

		if (!productIds || !Array.isArray(productIds)) {
			return res.status(400).json({ success: false, message: "productIds phải là một mảng." });
		}

		// CẢI TIẾN: Thêm .populate để lấy thông tin chi tiết của sản phẩm (bao gồm trường name)
		// Lưu ý: 'applicableProducts' phải khớp với tên ref trong Model Voucher của bạn
		let allVouchers = await models.voucher.find({ status: 1 }).populate("applicableProducts");

		if (!allVouchers || allVouchers.length === 0) {
			return res.status(200).json({ success: true, data: [] });
		}

		const result = productIds.map((pId) => {
			// 1. Lọc Voucher cho sản phẩm cụ thể
			const specificVouchers = allVouchers.filter(
				(v) => v.applicableProducts && Array.isArray(v.applicableProducts) && v.applicableProducts.some((p) => (p._id ? p._id.toString() : p.toString()) === pId.toString()),
			);

			// 2. Lọc Voucher toàn sàn (không có giới hạn sản phẩm)
			const globalVouchers = allVouchers.filter((v) => !v.applicableProducts || v.applicableProducts.length === 0);

			const combinedVouchers = [...specificVouchers, ...globalVouchers];

			// 3. TÌM TÊN SẢN PHẨM:
			let productName = "SẢN PHẨM";

			// Tìm trong mảng specificVouchers
			for (const v of specificVouchers) {
				const foundProduct = v.applicableProducts.find((p) => (p._id ? p._id.toString() : p.toString()) === pId.toString());
				if (foundProduct && foundProduct.name) {
					productName = foundProduct.name;
					break; // Tìm thấy tên rồi thì dừng vòng lặp
				}
			}

			return {
				productName: productName.toUpperCase(),
				vouchers: combinedVouchers.map((v) => ({
					_id: v._id,
					code: v.code,
					title: v.title,
					quantity: v.quantity, // Thêm dòng này
					discountType: v.discountType, // Thêm dòng này
					discountValue: v.discountValue, // Thêm dòng này
					minOrderValue: v.minOrderValue,
                    expiryDate: v.expiryDate,
					displayValue: v.discountType === 1 ? `Voucher ${v.discountValue}%` : `Voucher ${v.discountValue}k`,
				})),
			};
		});

		return res.status(200).json({ success: true, data: result });
	} catch (error) {
		console.error("Error at getVouchersForCart:", error);
		return res.status(500).json({ success: false, message: "Lỗi hệ thống: " + error.message });
	}
};

const getVoucherByProduct = async (req, res) => {
	try {
		const { productId } = req.params;

		const vouchers = await models.voucher.find({
			applicableProducts: productId,
		});

		return res.status(200).json({
			code: 200,
			data: vouchers,
			message: "get voucher successfully",
		});
	} catch (error) {
		return res.status(500).json({
			code: 500,
			message: error.message,
		});
	}
};

// [post] /api/voucher/add
const addVoucher = async (req, res, next) => {
	try {
		const data = req.body;
		// data.applicableProducts nên là một mảng các ObjectId sản phẩm gửi từ client
		let obj = new models.voucher(data);

		await obj.save();
		return res.status(200).json({ code: 200, message: "add successfully!" });
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};

// [put] /api/voucher/edit/:id
const editVoucher = async (req, res, next) => {
	try {
		const { id } = req.params;
		const data = req.body;

		await models.voucher.findByIdAndUpdate(id, data);
		return res.status(200).json({ code: 200, message: "update successfully!" });
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};

// [delete] /api/voucher/delete/:id
const deleteVoucher = async (req, res, next) => {
	try {
	const { id } = req.query;
		await models.voucher.findByIdAndDelete(id);
		return res.status(200).json({ code: 200, message: "delete successfully!" });
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};

module.exports = {
	list,
	addVoucher,
	editVoucher,
	deleteVoucher,
	getVoucherByProduct,
	getVouchersForCart,
};
