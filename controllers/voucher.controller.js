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

		// Lấy tất cả voucher có status = 1 và populate applicableProducts
		let allVouchers = await models.voucher.find({ status: 1 }).populate("applicableProducts");

		if (!allVouchers || allVouchers.length === 0) {
			return res.status(200).json({ success: true, data: [] });
		}

		// Lấy thông tin các Product để biết tên
		const ProductsModel = require("../models/Products").product;
		const productsInfo = await ProductsModel.find({ _id: { $in: productIds } });
		
		// Nhóm productIds theo tên sản phẩm
		const nameToIdsMap = new Map();
		productsInfo.forEach(p => {
			const name = p.name ? p.name.toUpperCase() : "SẢN PHẨM";
			if (!nameToIdsMap.has(name)) {
				nameToIdsMap.set(name, []);
			}
			nameToIdsMap.get(name).push(p._id.toString());
		});

		// Xử lý những productId không tìm thấy trong DB (nếu có)
		const foundIds = productsInfo.map(p => p._id.toString());
		productIds.forEach(pId => {
			if (!foundIds.includes(pId.toString())) {
				if (!nameToIdsMap.has("SẢN PHẨM")) {
					nameToIdsMap.set("SẢN PHẨM", []);
				}
				nameToIdsMap.get("SẢN PHẨM").push(pId.toString());
			}
		});

		const result = [];
		const globalVouchers = allVouchers.filter((v) => !v.applicableProducts || v.applicableProducts.length === 0);

		// Duyệt qua từng nhóm tên sản phẩm
		for (const [productName, groupedIds] of nameToIdsMap.entries()) {
			// Lọc voucher đặc thù cho ít nhất một ID trong nhóm này
			const specificVouchers = allVouchers.filter((v) => {
				if (!v.applicableProducts || !Array.isArray(v.applicableProducts)) return false;
				return v.applicableProducts.some((p) => {
					const applicableId = p._id ? p._id.toString() : p.toString();
					return groupedIds.includes(applicableId);
				});
			});

			// Tránh trùng lặp nếu có voucher vừa global vừa specific (thường không xảy ra, nhưng an toàn)
			const combinedVouchersSet = new Set([...specificVouchers, ...globalVouchers]);
			const combinedVouchers = Array.from(combinedVouchersSet);

			result.push({
				productName: productName,
				vouchers: combinedVouchers.map((v) => ({
					_id: v._id,
					code: v.code,
					title: v.title,
					quantity: v.quantity,
					discountType: v.discountType,
					discountValue: v.discountValue,
					minOrderValue: v.minOrderValue,
					expiryDate: v.expiryDate,
					applicableProducts: v.applicableProducts,
					displayValue: v.discountType === 1 ? `Voucher ${v.discountValue}%` : `Voucher ${v.discountValue}k`,
				})),
			});
		}

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
