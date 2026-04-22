const orderModel = require("../models/Orders");
const optionModel = require("../models/Option");
const productModel = require("../models/Products");
const { sendNotification } = require('../config/Fcm');
const infoModel = require("../models/Info");
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

	return totalPrice;
};

// 2. Hàm Tạo đơn hàng (Dùng chung cho cả COD và ZaloPay)
const createOrderDefault = async (req, res, next) => {
	try {
		const user_id = req.user._id;
		const { productsOrder, info_id, payment_method } = req.body;

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
		});

		const savedOrder = await newOrder.save();

		// NẾU LÀ COD (1): Trừ kho ngay lập tức
		if (payment_method === 1) {
			for (const product of productsOrder) {
				await optionModel.option.findByIdAndUpdate(product.option_id, {
					$inc: { quantity: -product.quantity, soldQuantity: product.quantity },
				});
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

const createOrder = async (req, res, next) => {
	try {
		const user_id = req.user._id;
		const { productsOrder, info_id } = req.body;
		console.log("test" + productsOrder);
		const total_price = await calculateTotalPrice(productsOrder);
		// Sử dụng đối tượng để theo dõi store_id và productsOrder tương ứng
		const newOrder = new orderModel.order({
			user_id,
			productsOrder,
			total_price,
			info_id,
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
			result: savedOrder,
			message: "created order successfully",
		});
	} catch (error) {
		console.log(error);
		return res.status(500).json({ code: 500, message: error.message });
	}
};

const createOrderByZalo = async (req, res, next) => {
	try {
		const user_id = req.user._id;
		const { productsOrder, info_id, payment_status } = req.body;

		const total_price = await calculateTotalPrice(productsOrder);
		// Sử dụng đối tượng để theo dõi store_id và productsOrder tương ứng
		const newOrder = new orderModel.order({
			user_id,
			productsOrder,
			total_price,
			info_id,
			payment_status,
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
			queryCondition.status = status;
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
							discount_value: productOrder.discount_value,
						};
					}),
				);

				return {
					_id: order._id,
					user_id: order.user_id,
					info_id: order.info_id,
					productsOrder,
					total_price: order.total_price,
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
		const { status } = req.body;

		const order = await orderModel.order.findById(orderId);

		if (!order) {
			return res.status(404).json({ code: 404, message: "order not found" });
		}

		if (status === "Đã hủy" && (order.status === "Chờ giao hàng" || order.status === "Đã giao hàng" || order.status === "Đang giao hàng")) {
			return res.status(409).json({ code: 409, message: "Don't change status order" });
		}
		const updatedOrder = await orderModel.order.findByIdAndUpdate(orderId, { status }, { new: true });

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
			await addOrderLog(orderId, adminName, "Cập nhật trạng thái", `${order.status} -> ${status}`);
		}

		return res.status(200).json({ code: 200, message: "Update status order successfully" });
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
          discount_value: discountValue,
          custom_name: product.custom_name || "",
          custom_price: customPrice,
        };
      })
    );

    const updatedOrder = await orderModel.order.findByIdAndUpdate(
      orderId,
      {
        status,
        payment_status,
        payment_method,
        delivery_method,
        ip,
        productsOrder: normalizedProducts,
        total_price,
      },
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

    return res.status(200).json({
      code: 200,
      result: updatedOrder,
      message: "update order successfully",
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ code: 500, message: error.message });
  }};

const detailOrders = async (req, res, next) => {
	try {
		const { orderId } = req.params;

		const orderDetail = await orderModel.order
			.findById(orderId)
			.populate("user_id", "email username full_name role_id is_active")
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

		return res.status(200).json({
			code: 200,
			result: orderDetail,
			message: "created order successfully",
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

		if (order.status != "Chờ xác nhận") {
			return res.status(409).json({ code: 409, message: "Don't cancel order" });
		}

		await orderModel.order.findByIdAndUpdate(orderId, { status: "Đã hủy" }, { new: true });

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
};
