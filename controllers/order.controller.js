const orderModel = require("../models/Orders");
const optionModel = require("../models/Option");
const productModel = require("../models/Products");
const { sendNotification } = require('../config/Fcm');
const infoModel = require("../models/Info");
const accountModel = require("../models/Account");
const { cancelOrderGHTK } = require("../services/ghtk.service");
const {
	assertCodAllowedForUser,
	syncTrustAfterOrderStatusChange,
} = require("../utils/userTrust");
const config = {
	app_id: "2555",
	key2: "trMrHtvjo6myautx6ujYwSv0Yra79trW",
};

const addOrderLog = async (orderId, adminName, action, details, note = "") => {
	await orderModel.order.findByIdAndUpdate(orderId, {
		$push: {
			admin_update_logs: {
				updated_by: adminName,
				action: action,
				details: details,
				note: note,
				timestamp: new Date(),
				to_time: new Date()
			}
		}
	});
};

const deleteOrder = async (req, res) => {
	try {
		const orderId = req.params.id; // Lấy ID từ URL

		const deletedOrder = await orderModel.order.findByIdAndDelete(orderId);

		if (!deletedOrder) {
			return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
		}

		res.status(200).json({ message: "Xóa đơn hàng thành công", id: orderId });
	} catch (error) {
		res.status(500).json({ message: "Lỗi Server", error: error.message });
	}
};

const calculateTotalPrice = async (productsOrder) => {
	let totalPrice = 0;

	for (const product of productsOrder) {
		const option = await optionModel.option.findById(product.option_id);

		if (option) {
			console.log(product.discountValue);
			const discountValue = product.discount_value || 0;
			totalPrice += option.price * (1 - discountValue / 100) * product.quantity;
		}
	}

	return Math.round(totalPrice);
};

// 2. Hàm Tạo đơn hàng (Dùng chung cho cả COD và ZaloPay)
const createOrderDefault = async (req, res, next) => {
	try {
		if (req.user && req.user.restrict_buy === true) {
			return res.status(403).json({
				code: 403,
				message: "Tài khoản của bạn bị hạn chế mua hàng. Vui lòng liên hệ Admin để được hỗ trợ.",
			});
		}

		const user_id = req.user._id;
		const { productsOrder, info_id, payment_method, voucher_ids } = req.body;

		if (payment_method !== 2) {
			try {
				await assertCodAllowedForUser(user_id);
			} catch (e) {
				if (e.code === "PAYMENT_RESTRICTED") {
					return res.status(403).json({ code: 403, message: e.message });
				}
				throw e;
			}
		}

		const total_price = await calculateTotalPrice(productsOrder);

		// Tạo app_trans_id định dạng YYMMDD_timestamp nếu là ZaloPay
		let app_trans_id = null;
		let initialStatus = "Chờ xác nhận";

		if (payment_method === 2) {
			app_trans_id = `${moment().format("YYMMDD")}_${Date.now()}`;
			initialStatus = "Chờ thanh toán";
		}

		const newOrder = new orderModel.order({
			user_id,
			productsOrder,
			total_price,
			info_id,
			payment_method, // 1: COD, 2: ZaloPay
			app_trans_id,
			status: initialStatus,
			payment_status: false,
			voucher_ids: voucher_ids || [],
		});

		const savedOrder = await newOrder.save();

		// NẾU LÀ COD (1): Trừ kho ngay lập tức
		if (payment_method === 1) {
			for (const product of productsOrder) {
				await optionModel.option.findByIdAndUpdate(product.option_id, {
					$inc: { quantity: -product.quantity, soldQuantity: product.quantity },
				});
			}
			if (voucher_ids && voucher_ids.length > 0) {
				const VoucherModel = require("../models/Voucher").voucher;
				for (const v_id of voucher_ids) {
					await VoucherModel.findByIdAndUpdate(v_id, {
						$inc: { quantity: -1 }
					});
				}
			}
		}

		// NẾU LÀ ZALOPAY (2): Không trừ kho ở đây, chờ Callback mới trừ
		return res.status(201).json({
			code: 201,
			result: savedOrder,
			message: payment_method === 2 ? "Đang chờ thanh toán ZaloPay" : "Đặt hàng thành công",
		});
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};

// 3. Hàm Callback (ZaloPay sẽ gọi vào đây khi khách quét mã thành công)
const zlCallback = async (req, res) => {
	let result = {};
	try {
		let dataStr = req.body.data;
		let reqMac = req.body.mac;

		// Xác thực chữ ký từ ZaloPay
		// let mac = CryptoJS.HmacSHA256(dataStr, config.key2).toString();

		// if (reqMac !== mac) {
		//   result.return_code = -1;
		//   result.return_message = "mac not equal";
		// } else {
		let dataJson = JSON.parse(dataStr);
		const app_trans_id = dataJson.app_trans_id;

		// Tìm đơn hàng theo mã giao dịch
		const order = await orderModel.order.findOne({ app_trans_id });

		if (order && order.status === "Chờ thanh toán") {
			// CẬP NHẬT TRẠNG THÁI THANH TOÁN
			order.payment_status = true;
			order.status = "Chờ xác nhận";
			await order.save();

			// BÂY GIỜ MỚI THỰC HIỆN TRỪ KHO
			for (const product of order.productsOrder) {
				await optionModel.option.findByIdAndUpdate(product.option_id, {
					$inc: { quantity: -product.quantity, soldQuantity: product.quantity },
				});
			}
			if (order.voucher_ids && order.voucher_ids.length > 0) {
				const VoucherModel = require("../models/Voucher").voucher;
				for (const v_id of order.voucher_ids) {
					await VoucherModel.findByIdAndUpdate(v_id, {
						$inc: { quantity: -1 }
					});
				}
			}
		}
		result.return_code = 1;
		result.return_message = "success";
		// }
	} catch (ex) {
		result.return_code = 0;
		result.return_message = ex.message;
	}
	res.json(result);
};

const scheduleQROrderCleanup = (orderId) => {
	// 15 minutes = 15 * 60 * 1000 ms
	setTimeout(async () => {
		try {
			const order = await orderModel.order.findById(orderId);
			if (order && order.status === "Chờ thanh toán" && order.payment_method === 3) {
				console.log(`Auto-cancelling QR order ${orderId} due to timeout...`);
				await orderModel.order.findByIdAndDelete(orderId);

				// Restore quantities
				for (const product of order.productsOrder) {
					await optionModel.option.findByIdAndUpdate(
						product.option_id,
						{ $inc: { quantity: product.quantity, soldQuantity: -product.quantity } }
					);
				}
				if (order.voucher_ids && order.voucher_ids.length > 0) {
					const VoucherModel = require("../models/Voucher").voucher;
					for (const v_id of order.voucher_ids) {
						await VoucherModel.findByIdAndUpdate(v_id, { $inc: { quantity: 1 } });
					}
				}
			}
		} catch (err) {
			console.error(`Error during QR order auto-cleanup for ${orderId}:`, err);
		}
	}, 15 * 60 * 1000);
};

const createOrder = async (req, res, next) => {
	try {
		const user_id = req.user._id;
		const { productsOrder, info_id, voucher_ids, payment_method } = req.body;
		console.log("test" + productsOrder);

		if (payment_method !== 3) {
			try {
				await assertCodAllowedForUser(user_id);
			} catch (e) {
				if (e.code === "PAYMENT_RESTRICTED") {
					return res.status(403).json({ code: 403, message: e.message });
				}
				throw e;
			}
		}

		const total_price = await calculateTotalPrice(productsOrder);

		const isQR = payment_method === 3;
		const initialStatus = isQR ? "Chờ thanh toán" : "Chờ xác nhận";

		const newOrder = new orderModel.order({
			user_id,
			productsOrder,
			total_price,
			info_id,
			payment_method: payment_method || 1,
			status: initialStatus,
			payment_status: false,
			voucher_ids: voucher_ids || [],
		});

		// Save the order to the database
		const savedOrder = await newOrder.save();
		// Loop through productsOrder array in the order
		for (const product of productsOrder) {
			const { option_id, quantity } = product;

			// Find and update the option by ID
			await optionModel.option.findByIdAndUpdate(
				option_id,
				{
					$inc: { quantity: -quantity, soldQuantity: quantity },
				},
				{ new: true },
			);
		}

		if (voucher_ids && voucher_ids.length > 0) {
			const VoucherModel = require("../models/Voucher").voucher;
			for (const v_id of voucher_ids) {
				await VoucherModel.findByIdAndUpdate(v_id, {
					$inc: { quantity: -1 }
				});
			}
		}

		// Nếu là QR, lập lịch tự động hủy sau 15 phút
		if (isQR) {
			scheduleQROrderCleanup(savedOrder._id);
		}

		return res.status(201).json({
			code: 201,
			result: savedOrder,
			message: isQR ? "Đang chờ thanh toán QR" : "created order successfully",
		});
	} catch (error) {
		console.log(error);
		return res.status(500).json({ code: 500, message: error.message });
	}
};

const cancelOrderQR = async (req, res, next) => {
	try {
		const { orderId } = req.params;
		const order = await orderModel.order.findById(orderId);

		if (!order) {
			return res.status(404).json({ code: 404, message: "Order not found" });
		}

		if (order.status !== "Chờ thanh toán") {
			return res.status(400).json({ code: 400, message: "Order is not in pending payment status" });
		}

		await orderModel.order.findByIdAndDelete(orderId);

		// Restore quantities
		for (const product of order.productsOrder) {
			await optionModel.option.findByIdAndUpdate(
				product.option_id,
				{ $inc: { quantity: product.quantity, soldQuantity: -product.quantity } }
			);
		}
		if (order.voucher_ids && order.voucher_ids.length > 0) {
			const VoucherModel = require("../models/Voucher").voucher;
			for (const v_id of order.voucher_ids) {
				await VoucherModel.findByIdAndUpdate(v_id, { $inc: { quantity: 1 } });
			}
		}

		return res.status(200).json({ code: 200, message: "QR Order cancelled and deleted successfully" });
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};

const confirmOrderQR = async (req, res, next) => {
	try {
		const { orderId } = req.params;
		const order = await orderModel.order.findById(orderId);

		if (!order) {
			return res.status(404).json({ code: 404, message: "Order not found" });
		}

		if (order.status !== "Chờ thanh toán") {
			return res.status(400).json({ code: 400, message: "Order is not in pending payment status" });
		}

		order.status = "Đã thanh toán";
		order.payment_status = true;
		await order.save();

		return res.status(200).json({ code: 200, message: "QR Order confirmed successfully" });
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};

const sepayWebhook = async (req, res, next) => {
	try {
		const authHeader = req.headers['authorization'];
		const apiKey = process.env.SEPAY_WEBHOOK_API_KEY;
		console.log("=== SEPAY WEBHOOK DEBUG ===");
		console.log("Headers nhận được:", JSON.stringify(req.headers, null, 2));
		console.log("Authorization header:", authHeader);
		console.log("Expected:", apiKey ? `Apikey ${apiKey}` : "(Không có SEPAY_WEBHOOK_API_KEY trong .env)");
		console.log("Body:", JSON.stringify(req.body, null, 2));
		console.log("===========================");

		if (apiKey && authHeader !== `Apikey ${apiKey}`) {
			console.log("❌ Xác thực thất bại - Header không khớp");
			return res.status(401).json({ success: false, message: "Unauthorized" });
		}
		console.log("✅ Xác thực thành công");

		const { id, transferType, transferAmount, content } = req.body;

		if (transferType !== 'in') {
			return res.status(200).json({ success: true, message: "Ignore outgoing transaction" });
		}

		const sepayTransId = `sepay_${id}`;
		const existingOrder = await orderModel.order.findOne({ app_trans_id: sepayTransId });
		if (existingOrder) {
			return res.status(200).json({ success: true, message: "Transaction already processed" });
		}

		const orderIdMatch = content ? content.match(/[0-9a-fA-F]{24}/) : null;
		if (!orderIdMatch) {
			return res.status(400).json({ success: false, message: "No order ID found in transaction content" });
		}

		const orderId = orderIdMatch[0];
		const order = await orderModel.order.findById(orderId);

		if (!order) {
			console.log(`❌ Order ${orderId} not found`);
			return res.status(404).json({
				success: false,
				message: "Order not found"
			});
		}

		const paidAmount = Number(transferAmount);
		const orderAmount = Number(order.total_price);

		console.log("transferAmount:", transferAmount);
		console.log("typeof transferAmount:", typeof transferAmount);
		console.log("paidAmount:", paidAmount);
		console.log("orderAmount:", orderAmount);

		if (paidAmount < orderAmount) {

			console.log("❌ THANH TOÁN KHÔNG ĐỦ");

			console.log({
				orderId: order._id,
				expectedAmount: orderAmount,
				receivedAmount: paidAmount,
				content
			});

			return res.status(400).json({
				success: false,
				message: `Số tiền không đủ. Cần ${orderAmount} nhưng chỉ nhận ${paidAmount}`
			});
		}

		order.app_trans_id = sepayTransId;

		if (order.status === "Chờ thanh toán") {
			order.status = "Đã thanh toán";
			order.payment_status = true;
			await order.save();

			try {
				const user = await accountModel.account.findById(order.user_id).lean();
				if (user) {
					const productNames = await Promise.all(order.productsOrder.map(async (po) => {
						const opt = await optionModel.option.findById(po.option_id).populate('product_id');
						return opt?.product_id?.name?.trim();
					}));
					const filtered = productNames.filter(Boolean);
					const productPreview = filtered.length > 2 ? filtered.slice(0, 2).join(', ') + ', ...' : filtered.join(', ');
					const title = "🛒 Cập nhật trạng thái đơn hàng";
					const body = productPreview
						? `Đơn hàng (${productPreview}) của bạn đã được cập nhật trạng thái: Đã thanh toán`
						: `Đơn hàng của bạn đã được cập nhật trạng thái: Đã thanh toán`;

					const notifiModel = require("../models/Notification");
					const newNoti = new notifiModel.notifi({
						sender_id: order.user_id, // Gửi từ hệ thống/chính user để hiển thị thông báo
						receiver_id: order.user_id,
						content: body,
						order_id: String(order._id),
						status: "unread",
						type: "wfc"
					});
					await newNoti.save();

					if (user.fcmToken) {
						await sendNotification(user.fcmToken, title, body, { order_id: String(order._id), status: "Đã thanh toán" });
					}
				}
			} catch (e) {
				console.error('Lỗi gửi thông báo trạng thái đơn hàng (SePay Webhook):', e);
			}
		} else {
			await order.save();
		}

		return res.status(200).json({ success: true, message: "Webhook processed successfully" });
	} catch (error) {
		console.error("SePay Webhook Error:", error);
		return res.status(500).json({ success: false, message: error.message });
	}
};

const createOrderByZalo = async (req, res, next) => {
	try {
		if (req.user && req.user.restrict_buy === true) {
			return res.status(403).json({
				code: 403,
				message: "Tài khoản của bạn bị hạn chế mua hàng. Vui lòng liên hệ Admin để được hỗ trợ.",
			});
		}

		const user_id = req.user._id;
		const { productsOrder, info_id, payment_status, voucher_ids } = req.body;

		const total_price = await calculateTotalPrice(productsOrder);
		// Sử dụng đối tượng để theo dõi store_id và productsOrder tương ứng
		const newOrder = new orderModel.order({
			user_id,
			productsOrder,
			total_price,
			info_id,
			payment_status,
			payment_method: 2,
			voucher_ids: voucher_ids || [],
		});

		// Save the order to the database
		const savedOrder = await newOrder.save();

		// Loop through productsOrder array in the order
		for (const product of productsOrder) {
			const { option_id, quantity } = product;

			// Find and update the option by ID
			await optionModel.option.findByIdAndUpdate(
				option_id,
				{
					$inc: { quantity: -quantity, soldQuantity: quantity },
				},
				{ new: true },
			);
		}

		return res.status(201).json({
			code: 201,
			result: {
				savedOrder: savedOrder,
			},
			message: "created order successfully",
		});
	} catch (error) {
		console.log(error);
		return res.status(500).json({ code: 500, message: error.message });
	}
};

// const updateOrder = async (req, res, next) => {
//   try {
//     const { order_id } = req.params;
//     const { productsOrder } = req.body;

//     // Update the order with new productsOrder
//     const updatedOrder = await orderModel.order.findByIdAndUpdate(
//       order_id,
//       { productsOrder },
//       { new: true }
//     );

//     res.status(200).json({
//       success: true,
//       message: 'Order updated successfully',
//       order: updatedOrder,
//     });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to update order',
//       error: error.message,
//     });
//   }
// };
const getOrdersByUserId = async (req, res, next) => {
	try {
		const userId = req.user._id;
		const { status } = req.query;

		const queryCondition = { user_id: userId };
		if (status) {
			if (status === "Chờ xác nhận") {
				queryCondition.status = { $in: ["Chờ xác nhận", "Đã thanh toán"] };
			} else if (status === "Chờ/Đang giao hàng") {
				// Bao gồm "shipping" (trạng thái sau khi admin xác nhận GHTK) để đơn không biến mất
				queryCondition.status = { $in: ["Chờ giao hàng", "shipping", "Đang giao hàng"] };
			} else {
				queryCondition.status = status;
			}
		}

		const orders = await orderModel.order.find(queryCondition).sort({ updatedAt: -1 }).populate(["user_id", "info_id"]);

		const result = await Promise.all(
			orders.map(async (order) => {
				const productsOrder = await Promise.all(
					order.productsOrder.map(async (productOrder) => {
						const option = await optionModel.option.findById(productOrder.option_id).lean().populate("product_id");

						return {
							option_id: option,
							quantity: productOrder.quantity,
							discount_value: Math.round(productOrder.discount_value || 0),
						};
					}),
				);

				return {
					_id: order._id,
					user_id: order.user_id,
					info_id: order.info_id,
					productsOrder,
					total_price: Math.round(order.total_price || 0),
					status: order.status,
					payment_method: order.payment_method,
					payment_status: order.payment_status,
					app_trans_id: order.app_trans_id,
					reason: order.reason || "",
					createdAt: order.createdAt,
					updatedAt: order.updatedAt,
				};
			}),
		);

		return res.status(200).json({
			code: 200,
			result: result,
			message: "get list order successfully",
		});
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};

const updateOrderStatus = async (req, res, next) => {
	try {
		const { orderId } = req.params;
		const { status, note, reason } = req.body;

		const order = await orderModel.order.findById(orderId);

		if (!order) {
			return res.status(404).json({ code: 404, message: "order not found" });
		}

		const role = req.user?.role_id;
		const isStaff = role === "admin" || role === "staff";

		const logisticsStatuses = new Set([
			"shipping",
			"Đang giao hàng",
			"Đã giao hàng",
		]);
		if (logisticsStatuses.has(status) && order.status !== status) {
			return res.status(409).json({
				code: 409,
				message:
					"Không thể đổi trạng thái giao hàng thủ công. Dùng «Xác nhận đơn» (GHTK) và «Làm mới trạng thái GHTK».",
			});
		}

		if (
			status === "Đã hủy" &&
			(order.status === "Đã giao hàng" ||
				(order.status === "Đang giao hàng" && !isStaff))
		) {
			return res.status(409).json({ code: 409, message: "Don't change status order" });
		}
		if (status === "Đã hủy") {
			const trackingCode = order.ghtk?.trackingCode || order.ghtk?.label;
			if (trackingCode) {
				try {
					const ghtkRes = await cancelOrderGHTK(trackingCode);
					if (!ghtkRes.success) {
						const msg = ghtkRes.message || "";
						const isAlreadyCancelled = /đã ở trạng thái hủy|đã được hủy|đã hủy/.test(msg.toLowerCase());
						const isNotFound = /không tồn tại|không tìm thấy/.test(msg.toLowerCase());
						
						if (!isAlreadyCancelled && !isNotFound) {
							return res.status(409).json({
								code: 409,
								message: `Không thể hủy đơn hàng trên GHTK: ${msg}`,
								ghtk: ghtkRes
							});
						}
					}
				} catch (error) {
					console.error("Lỗi khi hủy đơn trên GHTK (updateOrderStatus):", error);
					if (error.response && error.response.status === 400 && error.response.data) {
						const ghtkRes = error.response.data;
						const msg = ghtkRes.message || "";
						const isAlreadyCancelled = /đã ở trạng thái hủy|đã được hủy|đã hủy/.test(msg.toLowerCase());
						const isNotFound = /không tồn tại|không tìm thấy/.test(msg.toLowerCase());
						
						if (isAlreadyCancelled || isNotFound) {
							console.log(`[GHTK] GHTK báo lỗi 400 (${msg}) nhưng là ngoại lệ an toàn. Tiếp tục hủy cục bộ.`);
						} else {
							return res.status(409).json({
								code: 409,
								message: `Không thể hủy đơn hàng trên GHTK: ${msg}`,
								ghtk: ghtkRes
							});
						}
					} else if (error.response && error.response.status === 404) {
						console.log("[GHTK] API trả về 404 Not Found, tiếp tục hủy đơn cục bộ.");
					} else {
						return res.status(502).json({
							code: 502,
							message: `Lỗi kết nối với đối tác vận chuyển GHTK: ${error.message}`
						});
					}
				}
			}
		}

		const updateData = { status };
		if (status === "Đã thanh toán") {
			updateData.payment_status = true;
		}
		if (status === "Đã giao hàng" && order.status !== "Đã giao hàng" && !order.completedAt) {
			updateData.completedAt = new Date();
		}

		const finalReason = note || reason || "";
		if (status === "Đã hủy" && finalReason) {
			updateData.reason = finalReason;
		}

		const updatedOrder = await orderModel.order.findByIdAndUpdate(orderId, updateData, { new: true });

		// Check if the order status is updated successfully
		if (!updatedOrder) {
			return res.status(404).json({ code: 404, message: "Order not found" });
		}

		// If the order status is updated to 'Đã giao hàng', update quantity and soldQuantity
		if (status === "Đã giao hàng") {
			// // Loop through productsOrder array in the order
			// for (const product of updatedOrder.productsOrder) {
			//   const { option_id, quantity } = product;
			//   // Find and update the option by ID
			//   await optionModel.option.findByIdAndUpdate(
			//     option_id,
			//     {
			//       $inc: { quantity: -quantity, soldQuantity: quantity },
			//     },
			//     { new: true }
			//   );
			// }
		}

		if (order.status !== status) {
			const adminName = req.user ? (req.user.username || req.user.full_name || req.user.email || "Admin") : "System";
			await addOrderLog(orderId, adminName, "Cập nhật trạng thái", `${order.status} -> ${status}`, finalReason);

			// Restore quantity if cancelled and it was previously deducted
			if (status === "Đã hủy" && order.status !== "Chờ thanh toán" && order.status !== "Đã hủy") {
				for (const product of order.productsOrder) {
					await optionModel.option.findByIdAndUpdate(
						product.option_id,
						{ $inc: { quantity: product.quantity, soldQuantity: -product.quantity } }
					);
				}
				if (order.voucher_ids && order.voucher_ids.length > 0) {
					const VoucherModel = require("../models/Voucher").voucher;
					for (const v_id of order.voucher_ids) {
						await VoucherModel.findByIdAndUpdate(v_id, { $inc: { quantity: 1 } });
					}
				}
			}

			try {
				await syncTrustAfterOrderStatusChange(
					updatedOrder.user_id,
					order.status,
					status,
					finalReason
				);
			} catch (e) {
				console.error("trust_score sync:", e);
			}
		}

		// ---- Send push notification to user about status change ----
		try {
			const user = await accountModel.account.findById(updatedOrder.user_id).lean();
			if (user) {
				const productNames = await Promise.all(updatedOrder.productsOrder.map(async (po) => {
					const opt = await optionModel.option.findById(po.option_id).populate('product_id');
					return opt?.product_id?.name?.trim();
				}));
				const filtered = productNames.filter(Boolean);
				const productPreview = filtered.length > 2 ? filtered.slice(0, 2).join(', ') + ', ...' : filtered.join(', ');
				const title = "🛒 Cập nhật trạng thái đơn hàng";
				const body = productPreview
					? `Đơn hàng (${productPreview}) của bạn đã được cập nhật trạng thái: ${status}`
					: `Đơn hàng của bạn đã được cập nhật trạng thái: ${status}`;

				// Lưu thông báo vào CSDL để app có thể hiển thị trong tab Thông báo
				const notifiModel = require("../models/Notification");
				const newNoti = new notifiModel.notifi({
					sender_id: req.user ? req.user._id : updatedOrder.user_id, // Admin hoặc hệ thống
					receiver_id: updatedOrder.user_id,
					content: body,
					order_id: String(orderId),
					status: "unread",
					type: "wfc" // Dùng type tương ứng (tuỳ chỉnh theo status nếu cần)
				});
				await newNoti.save();

				// Chỉ gửi push nếu user có token
				if (user.fcmToken) {
					await sendNotification(user.fcmToken, title, body, { order_id: String(orderId), status: String(status) });
				}
			}
		} catch (e) {
			console.error('Lỗi gửi thông báo trạng thái đơn hàng:', e);
		}

		const finalOrder = await orderModel.order.findById(orderId).lean();
		return res.status(200).json({ code: 200, result: finalOrder, message: "Update status order successfully" });
	} catch (error) {
		console.log(error);
		return res.status(500).json({ code: 500, message: error.message });
	}
};
const updateOrder = async (req, res, next) => {
	try {
		const { orderId } = req.params;
		const {
			status,
			payment_status,
			payment_method,
			delivery_method,
			ip,
			info_id,
			productsOrder = [],
			note,
		} = req.body;

		const order = await orderModel.order.findById(orderId);
		if (!order) {
			return res.status(404).json({ code: 404, message: "order not found" });
		}

		const logisticsStatuses = new Set([
			"shipping",
			"Đang giao hàng",
			"Đã giao hàng",
		]);
		if (
			status &&
			logisticsStatuses.has(status) &&
			order.status !== status
		) {
			return res.status(409).json({
				code: 409,
				message:
					"Không thể đổi trạng thái giao hàng thủ công. Dùng API GHTK (xác nhận / tracking).",
			});
		}

		if (status === "Đã hủy") {
			const trackingCode = order.ghtk?.trackingCode || order.ghtk?.label;
			if (trackingCode) {
				try {
					const ghtkRes = await cancelOrderGHTK(trackingCode);
					if (!ghtkRes.success) {
						const msg = ghtkRes.message || "";
						const isAlreadyCancelled = /đã ở trạng thái hủy|đã được hủy|đã hủy/.test(msg.toLowerCase());
						const isNotFound = /không tồn tại|không tìm thấy/.test(msg.toLowerCase());
						
						if (!isAlreadyCancelled && !isNotFound) {
							return res.status(409).json({
								code: 409,
								message: `Không thể hủy đơn hàng trên GHTK: ${msg}`,
								ghtk: ghtkRes
							});
						}
					}
				} catch (error) {
					console.error("Lỗi khi hủy đơn trên GHTK (updateOrder):", error);
					if (error.response && error.response.status === 400 && error.response.data) {
						const ghtkRes = error.response.data;
						const msg = ghtkRes.message || "";
						const isAlreadyCancelled = /đã ở trạng thái hủy|đã được hủy|đã hủy/.test(msg.toLowerCase());
						const isNotFound = /không tồn tại|không tìm thấy/.test(msg.toLowerCase());
						
						if (isAlreadyCancelled || isNotFound) {
							console.log(`[GHTK] GHTK báo lỗi 400 (${msg}) nhưng là ngoại lệ an toàn. Tiếp tục hủy cục bộ.`);
						} else {
							return res.status(409).json({
								code: 409,
								message: `Không thể hủy đơn hàng trên GHTK: ${msg}`,
								ghtk: ghtkRes
							});
						}
					} else if (error.response && error.response.status === 404) {
						console.log("[GHTK] API trả về 404 Not Found, tiếp tục hủy đơn cục bộ.");
					} else {
						return res.status(502).json({
							code: 502,
							message: `Lỗi kết nối với đối tác vận chuyển GHTK: ${error.message}`
						});
					}
				}
			}
		}

		if (info_id && typeof info_id === "object" && order.info_id) {
			await infoModel.info.findByIdAndUpdate(order.info_id, {
				name: info_id.name,
				address: info_id.address,
				phone_number: info_id.phone_number,
			});
		}

		let total_price = 0;
		const normalizedProducts = await Promise.all(
			(productsOrder || []).map(async (product) => {
				const quantity = Number(product.quantity || 1);
				const discountValue = Number(product.discount_value || 0);
				const customPrice = Number(product.custom_price || 0);
				let unitPrice = customPrice;

				if (!unitPrice && product.option_id) {
					const option = await optionModel.option.findById(product.option_id);
					unitPrice = Number(option?.price || 0);
				}

				const finalPrice = Math.max(unitPrice - (unitPrice * discountValue) / 100, 0);
				total_price += finalPrice * quantity;

				return {
					option_id: product.option_id || null,
					quantity,
					discount_value: Math.round(discountValue),
					custom_name: product.custom_name || "",
					custom_price: customPrice,
				};
			})
		);

		const nextPaymentMethod =
			payment_method !== undefined && payment_method !== null
				? payment_method
				: order.payment_method;
		if (nextPaymentMethod === 1) {
			try {
				await assertCodAllowedForUser(order.user_id);
			} catch (e) {
				if (e.code === "PAYMENT_RESTRICTED") {
					return res.status(403).json({ code: 403, message: e.message });
				}
				throw e;
			}
		}

		const updateData = {
			status,
			payment_status,
			payment_method,
			delivery_method,
			ip,
			productsOrder: normalizedProducts,
			total_price: Math.round(total_price),
		};

		if (status === "Đã giao hàng" && order.status !== "Đã giao hàng" && !order.completedAt) {
			updateData.completedAt = new Date();
		}

		const updatedOrder = await orderModel.order.findByIdAndUpdate(
			orderId,
			updateData,
			{ new: true }
		);

		if (updatedOrder) {
			let updateDetails = [];
			if (order.status !== status) updateDetails.push(`Trạng thái: ${order.status} -> ${status}`);
			if (order.payment_status !== payment_status) updateDetails.push(`Thanh toán: ${order.payment_status} -> ${payment_status}`);
			if (order.total_price !== total_price) updateDetails.push(`Tổng tiền: ${order.total_price} -> ${total_price}`);

			let detailsStr = updateDetails.length > 0 ? updateDetails.join(', ') : "Cập nhật thông tin đơn hàng/sản phẩm";

			const adminName = req.user ? (req.user.username || req.user.full_name || req.user.email || "Admin") : "System";
			await addOrderLog(orderId, adminName, "Sửa đơn hàng", detailsStr, note || "");
		}

		if (
			typeof status === "string" &&
			order.status !== status &&
			updatedOrder?.user_id
		) {
			try {
				await syncTrustAfterOrderStatusChange(
					updatedOrder.user_id,
					order.status,
					status,
					note
				);
			} catch (e) {
				console.error("trust_score sync (updateOrder):", e);
			}
		}

		return res.status(200).json({
			code: 200,
			result: updatedOrder,
			message: "update order successfully",
		});
	} catch (error) {
		console.log(error);
		return res.status(500).json({ code: 500, message: error.message });
	}
};

const detailOrders = async (req, res, next) => {
	try {
		const { orderId } = req.params;

		const orderDetail = await orderModel.order
			.findById(orderId)
			.populate(
				"user_id",
				"email username full_name role_id is_active trust_score is_blacklisted"
			)
			.populate({
				path: "productsOrder",
				populate: {
					path: "option_id",
					model: "option",
					populate: {
						path: "product_id",
						model: "product",
					},
				},
			})
			.populate("info_id");

		// Kiểm tra xem order có tồn tại không
		if (!orderDetail) {
			return res.status(404).json({ error: "Order not found" });
		}

		const orderObj = orderDetail.toObject();
		orderObj.total_price = Math.round(orderObj.total_price || 0);
		if (orderObj.productsOrder) {
			orderObj.productsOrder.forEach(p => {
				p.discount_value = Math.round(p.discount_value || 0);
			});
		}

		return res.status(200).json({
			code: 200,
			result: orderObj,
			message: "get detail order successfully",
		});
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};

// const ordersForStore = async (req, res, next) => {
//   try {
//     const store_id = req.store._id;
//     const { status } = req.query;

//     // Tìm tất cả các sản phẩm thuộc cửa hàng
//     const productsInStore = await productModel.product.find({ store_id });

//     // Lấy danh sách id của các sản phẩm thuộc cửa hàng
//     const productIds = productsInStore.map((product) => product._id);

//     // Tìm tất cả các option thuộc các sản phẩm của cửa hàng
//     const optionsInStore = await optionModel.option.find({
//       product_id: { $in: productIds },
//     });

//     // Lấy danh sách id của các option thuộc cửa hàng
//     const optionIds = optionsInStore.map((option) => option._id);

//     // Tìm tất cả các đơn đặt hàng chứa các option thuộc cửa hàng
//     const foundOrders = await orderModel.order
//       .find({
//         "productsOrder.option_id": { $in: optionIds },
//         status: status || { $exists: true }, // Lọc theo trạng thái nếu được chỉ định
//       })
//       .populate({
//         path: "productsOrder",
//         populate: {
//           path: "option_id",
//           model: "option",
//           populate: {
//             path: "product_id",
//             model: "product",
//           },
//         },
//       })
//       .populate("info_id")
//       .populate("user_id")
//       .exec();

//     return res.status(200).json({
//       code: 200,
//       result: foundOrders,
//       message: "Retrieved orders successfully for the store",
//     });
//   } catch (error) {
//     console.log(error);
//     return res.status(500).json({ code: 500, message: error.message });
//   }
// };

// const collectOrders = async (req, res, next) => {
//   try {
//     const storeId = req.store._id;

//     // Find orders with the "Đã giao hàng" status and the specified storeId
//     const orders = await orderModel.order
//       .find({ status: "Đã giao hàng" })
//       .populate({
//         path: "productsOrder",
//         populate: {
//           path: "option_id",
//           model: "option",
//           populate: {
//             path: "product_id",
//             model: "product",
//             match: { store_id: storeId },
//             select: "name",
//           },
//         },
//       })
//       .populate("user_id")
//       .exec();
//     console.log(orders);
//     res.status(200).json({
//       code: 200,
//       result: orders,
//       message: "get collect order success!",
//     });
//   } catch (error) {
//     console.error("Error in catch block:", error);
//     return res.status(500).json({ code: 500, message: error.message });
//   }
// };

const cancelOrder = async (req, res, next) => {
	try {
		const { orderId } = req.params;

		const order = await orderModel.order.findById(orderId);

		if (!order) {
			return res.status(404).json({ code: 404, message: "order not found" });
		}

		const allowedStatuses = new Set(["Chờ xác nhận", "shipping", "Chờ giao hàng"]);
		if (!allowedStatuses.has(order.status)) {
			return res.status(409).json({ code: 409, message: "Don't cancel order" });
		}

		const trackingCode = order.ghtk?.trackingCode || order.ghtk?.label;
		if (trackingCode) {
			try {
				const ghtkRes = await cancelOrderGHTK(trackingCode);
				if (!ghtkRes.success) {
					const msg = ghtkRes.message || "";
					const isAlreadyCancelled = /đã ở trạng thái hủy|đã được hủy|đã hủy/.test(msg.toLowerCase());
					const isNotFound = /không tồn tại|không tìm thấy/.test(msg.toLowerCase());
					
					if (!isAlreadyCancelled && !isNotFound) {
						return res.status(409).json({
							code: 409,
							message: `Không thể hủy đơn hàng trên GHTK: ${msg}`,
							ghtk: ghtkRes
						});
					}
				}
			} catch (error) {
				console.error("Lỗi khi hủy đơn trên GHTK (cancelOrder):", error);
				if (error.response && error.response.status === 400 && error.response.data) {
					const ghtkRes = error.response.data;
					const msg = ghtkRes.message || "";
					const isAlreadyCancelled = /đã ở trạng thái hủy|đã được hủy|đã hủy/.test(msg.toLowerCase());
					const isNotFound = /không tồn tại|không tìm thấy/.test(msg.toLowerCase());
					
					if (isAlreadyCancelled || isNotFound) {
						console.log(`[GHTK] GHTK báo lỗi 400 (${msg}) nhưng là ngoại lệ an toàn. Tiếp tục hủy cục bộ.`);
					} else {
						return res.status(409).json({
							code: 409,
							message: `Không thể hủy đơn hàng trên GHTK: ${msg}`,
							ghtk: ghtkRes
						});
					}
				} else if (error.response && error.response.status === 404) {
					console.log("[GHTK] API trả về 404 Not Found, tiếp tục hủy đơn cục bộ.");
				} else {
					return res.status(502).json({
						code: 502,
						message: `Lỗi kết nối với đối tác vận chuyển GHTK: ${error.message}`
					});
				}
			}
		}

		await orderModel.order.findByIdAndUpdate(orderId, { status: "Đã hủy" }, { new: true });

		try {
			await syncTrustAfterOrderStatusChange(order.user_id, order.status, "Đã hủy", "Khách hàng tự hủy");
		} catch (e) {
			console.error("trust score sync err:", e);
		}

		// Restore quantities since order was in "Chờ xác nhận" (meaning deducted)
		for (const product of order.productsOrder) {
			await optionModel.option.findByIdAndUpdate(
				product.option_id,
				{ $inc: { quantity: product.quantity, soldQuantity: -product.quantity } }
			);
		}
		if (order.voucher_ids && order.voucher_ids.length > 0) {
			const VoucherModel = require("../models/Voucher").voucher;
			for (const v_id of order.voucher_ids) {
				await VoucherModel.findByIdAndUpdate(v_id, { $inc: { quantity: 1 } });
			}
		}

		return res.status(200).json({ code: 200, message: "update stutus order successfully" });
	} catch (error) {
		return res.status(500).json({ code: 500, message: error.message });
	}
};

const getAllOrder = async (req, res, next) => {
	try {
		const user = req.user._id;
		if (!user.role_id == "admin" || !user.role_id == "staff") {
			return res.status(403).json({
				code: 403,
				message: "You do not have permission to use this function",
			});
		}
		const order = await orderModel.order
			.find()
			.populate("user_id", "email username full_name is_active")
			.populate({
				path: "productsOrder",
				populate: {
					path: "option_id",
					model: "option",
					populate: {
						path: "product_id",
						model: "product",
						select: "name",
					},
				},
			})
			.populate("info_id")
			.sort({ createdAt: -1 });
		return res.status(200).json({
			code: 200,
			result: order,
			message: "get order successfully",
		});
	} catch (error) {
		console.log(error);
		return res.status(500).json({ code: 500, message: error.message });
	}
};


module.exports = {
	deleteOrder,
	createOrder,
	getOrdersByUserId,
	updateOrderStatus,
	updateOrder,
	detailOrders,
	// ordersForStore,
	// collectOrders,
	cancelOrder,
	getAllOrder,
	createOrderByZalo,
	createOrderDefault,
	zlCallback,
	cancelOrderQR,
	confirmOrderQR,
	sepayWebhook,
};
