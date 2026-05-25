const { cloudinary } = require("../config/SetupCloudinary");
const model = require("../models/Account");
const bcrypt = require("bcrypt");

const detailProfile = async (req, res, next) => {
  try {
    const uid = req.params.uid;
    const user = await model.account.findById(uid);
    if (!user) {
      return res.status(404).json({ code: 404, message: "User not found" });
    }

    const orderModel = require("../models/Orders");
    const totalOrders = await orderModel.order.countDocuments({ user_id: uid });
    const successOrders = await orderModel.order.countDocuments({ user_id: uid, status: "Đã giao hàng" });
    const cancelledOrders = await orderModel.order.countDocuments({ user_id: uid, status: "Đã hủy" });
    const pendingConfirmation = await orderModel.order.countDocuments({ user_id: uid, status: "Chờ xác nhận" });
    const pendingPayment = await orderModel.order.countDocuments({ user_id: uid, status: "Chờ thanh toán" });
    const shippingOrders = await orderModel.order.countDocuments({ user_id: uid, status: { $in: ["Chờ giao hàng", "Đang giao hàng"] } });

    const orderStats = {
      total: totalOrders,
      success: successOrders,
      cancelled: cancelledOrders,
      pendingConfirmation: pendingConfirmation,
      pendingPayment: pendingPayment,
      shipping: shippingOrders,
    };

    const userData = user.toObject();
    userData.orderStats = orderStats;

    return res
      .status(200)
      .json({ code: 200, data: userData, message: "get user success" });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const editProfile = async (req, res, next) => {
  try {
    const uid = req.params.uid;
    const user = await model.account.findById(uid);
    if (!user) {
      return res.status(404).json({ code: 404, message: "User not found" });
    }
    const dataUpdate = { ...req.body };
    delete dataUpdate.trust_score;
    delete dataUpdate.is_blacklisted;
    const data = await model.account.findByIdAndUpdate(uid, dataUpdate, {
      new: true,
    });
    return res
      .status(200)
      .json({ code: 200, data: data, message: "update successful" });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const uploadAvatar = async (req, res, next) => {
  try {
    const uid = req.params.uid;
    const user = await model.account.findById(uid);
    if (!user) {
      return res.status(404).json({ code: 404, message: "User not found" });
    }

    console.log(req.file);
    if (!req.file) {
      return res.status(404).json({ code: 404, message: "file not found" });
    }

    if (user.avatar) {
      const public_id = user.avatar.split(
        "https://res.cloudinary.com/dwxavjnvc/image/upload/"
      );
      await cloudinary.uploader.destroy(public_id);
    }

    let image = req.file.path;
    const data = await model.account.findByIdAndUpdate(
      uid,
      { avatar: image },
      { new: true }
    );
    return res
      .status(200)
      .json({ code: 200, data: data, message: "upload avatar successful" });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const uid = req.params.uid;
    const user = await model.account.findById(uid);
    let { oldPassword, newPassword } = req.body;
    if (!user) {
      return res.status(404).json({ code: 404, message: "User not found" });
    }

    // compare password
    const passwordMatch = await bcrypt.compare(oldPassword, user.password);

    if (!passwordMatch) {
      return res.status(401).json({ code: 401, message: "Incorrect password" });
    }

    const salt = await bcrypt.genSalt(10);
    newPassword = await bcrypt.hash(newPassword, salt);
    await model.account.findByIdAndUpdate(
      uid,
      { password: newPassword },
      { new: true }
    );
    return res
      .status(200)
      .json({ code: 200, message: "update password successful" });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const allUser = async (req, res, next) => {
  try {
    const user = req.user;
    if (user.role_id == "customer") {
      return res.status(403).json({
        code: 403,
        message: "You do not have permission to use this function",
      });
    }

    const page = parseInt(req.query.page) || 1;
    const pageItem = parseInt(req.query.pageItem) || 100000;
    const role = req.query.role;

    const totalUsers = await model.account.countDocuments();
    const totalPages = Math.ceil(totalUsers / pageItem);

    const users = await model.account
      .find(role ? { role_id: role } : null)
      .skip((page - 1) * pageItem)
      .limit(pageItem);
    const result = users.map((user) => {
      return {
        _id: user._id,
        email: user.email,
        username: user.username,
        full_name: user.full_name,
        avatar: user.avatar,
        role: user.role_id,
        is_active: user.is_active,
        wallet_balance: user.wallet_balance || 0,
      };
    });
    return res.status(200).json({
      code: 200,
      result: result,
      totalPages: totalPages,
      currentPage: page,
      message: "get all success",
    });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const changeActiveUser = async (req, res, next) => {
  try {
    const user = req.user;
    if (user.role_id == "customer") {
      return res.status(403).json({
        code: 403,
        message: "You do not have permission to use this function",
      });
    }

    const { uid } = req.params;
    const { reason } = req.body;

    const account = await model.account.findById(uid);
    if (!account) {
      return res.status(404).json({ code: 404, message: "User not found" });
    }

    let active = !account.is_active;
    const adminName = user.username || user.email || "Admin";
    const logAction = active ? "Kích hoạt" : "Hủy kích hoạt";

    const updatedAccount = await model.account.findByIdAndUpdate(
      uid,
      {
        is_active: active,
        $push: {
          admin_logs: {
            updated_by: adminName,
            action: logAction,
            reason: reason || "",
            to_time: new Date()
          }
        }
      },
      { new: true }
    );

    // Nếu tài khoản bị vô hiệu hóa (khóa)
    if (!active) {
      try {
        const orderModel = require("../models/Orders");
        const optionModel = require("../models/Option");
        const VoucherModel = require("../models/Voucher").voucher;

        // 1. Tìm tất cả đơn hàng chưa hoàn thành của người dùng này
        const uncompletedOrders = await orderModel.order.find({
          user_id: uid,
          status: { $nin: ["Đã giao hàng", "Đã hủy"] }
        });

        // 2. Lặp qua từng đơn hàng để thực hiện hủy và hoàn tài nguyên
        for (const order of uncompletedOrders) {
          try {
            const oldStatus = order.status;
            order.status = "Đã hủy";
            order.reason = "Tự động hủy do tài khoản bị khóa bởi Admin";
            
            // Thêm log cập nhật đơn hàng
            order.admin_update_logs.push({
              updated_by: adminName,
              action: "Hủy tự động (Khóa tài khoản)",
              details: `Trạng thái: ${oldStatus} -> Đã hủy (Lý do: Tài khoản bị khóa)`,
              note: reason || "Admin khóa tài khoản",
              to_time: new Date()
            });

            // Lưu đơn hàng đã hủy
            await order.save();

            // Hoàn trả số lượng kho cho từng sản phẩm/tùy chọn (nếu đã trừ)
            const hasStockBeenDeducted = (oldStatus !== "Chờ thanh toán" || order.payment_method === 3);
            if (hasStockBeenDeducted) {
              for (const product of order.productsOrder) {
                if (product.option_id) {
                  await optionModel.option.findByIdAndUpdate(
                    product.option_id,
                    { 
                      $inc: { 
                        quantity: product.quantity, 
                        soldQuantity: -product.quantity 
                      } 
                    }
                  );
                }
              }

              // Hoàn trả voucher nếu có áp dụng
              if (order.voucher_ids && order.voucher_ids.length > 0) {
                for (const v_id of order.voucher_ids) {
                  await VoucherModel.findByIdAndUpdate(v_id, {
                    $inc: { quantity: 1 }
                  });
                }
              }
            }
          } catch (err) {
            console.error(`Lỗi khi tự động hủy đơn hàng ${order._id} do khóa tài khoản:`, err);
          }
        }
      } catch (err) {
        console.error("Lỗi khi quét đơn hàng để tự động hủy do khóa tài khoản:", err);
      }
    }

    return res
      .status(200)
      .json({
        code: 200,
        message: "change active user successfully",
        is_active: active,
        admin_logs: updatedAccount.admin_logs
      });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const createAccountStaff = async (req, res, next) => {
  try {
    const user = req.user;
    if (user.role_id != "admin") {
      return res.status(403).json({
        code: 403,
        message: "You do not have permission to use this function",
      });
    }
    const { email, password, role_id } = req.body;
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const newAccount = await model.account.create({
      email: email,
      password: passwordHash,
      role_id: "staff",
      is_active: true,
      isVerify: true,
    });
    return res
      .status(201)
      .json({ code: 201, result: newAccount, message: "created successfully" });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const changeActiveStaff = async (req, res) => {
  try {
    const user = req.user;
    if (user.role_id != "admin") {
      return res.status(403).json({
        code: 403,
        message: "You do not have permission to use this function",
      });
    }
    const { staffId } = req.params;
    const staff = await model.account.findById(staffId);
    if (!staff) {
      return res.status(404).json({ code: 404, message: "not found" });
    }

    if (staff.role_id != "staff") {
      return res
        .status(409)
        .json({ code: 409, message: "account don't staff" });
    }

    await model.account.findByIdAndDelete(staffId);
    return res.status(204).json({ code: 204, message: "account deleted" });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
  
};

const changeRestrictBuy = async (req, res, next) => {
  try {
    const user = req.user;
    if (user.role_id == "customer") {
      return res.status(403).json({
        code: 403,
        message: "You do not have permission to use this function",
      });
    }

    const { uid } = req.params;
    const { reason } = req.body;

    const account = await model.account.findById(uid);
    if (!account) {
      return res.status(404).json({ code: 404, message: "User not found" });
    }

    let restrict = !account.restrict_buy;
    const adminName = user.username || user.email || "Admin";
    const logAction = restrict ? "Hạn chế mua hàng" : "Bỏ hạn chế mua hàng";

    const updatedAccount = await model.account.findByIdAndUpdate(
      uid,
      {
        restrict_buy: restrict,
        $push: {
          admin_logs: {
            updated_by: adminName,
            action: logAction,
            reason: reason || "",
            to_time: new Date()
          }
        }
      },
      { new: true }
    );

    return res
      .status(200)
      .json({
        code: 200,
        message: "Change restrict buy successfully",
        restrict_buy: restrict,
        admin_logs: updatedAccount.admin_logs
      });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const changeRestrictCod = async (req, res, next) => {
  try {
    const user = req.user;
    if (user.role_id == "customer") {
      return res.status(403).json({
        code: 403,
        message: "You do not have permission to use this function",
      });
    }

    const { uid } = req.params;
    const { reason } = req.body;

    const account = await model.account.findById(uid);
    if (!account) {
      return res.status(404).json({ code: 404, message: "User not found" });
    }

    let restrict = !account.is_blacklisted;
    const adminName = user.username || user.email || "Admin";
    const logAction = restrict ? "Chỉ cho thanh toán chuyển khoản" : "Cho phép thanh toán COD";

    const updatedAccount = await model.account.findByIdAndUpdate(
      uid,
      {
        is_blacklisted: restrict,
        $push: {
          admin_logs: {
            updated_by: adminName,
            action: logAction,
            reason: reason || "",
            to_time: new Date()
          }
        }
      },
      { new: true }
    );

    return res
      .status(200)
      .json({
        code: 200,
        message: "Change restrict COD successfully",
        is_blacklisted: restrict,
        admin_logs: updatedAccount.admin_logs
      });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const getWalletInfo = async (req, res, next) => {
  try {
    const walletService = require("../services/wallet.service");
    const userId = req.user._id;
    const walletData = await walletService.getWalletInfo(userId);
    return res.status(200).json({
      code: 200,
      data: walletData,
      message: "Get wallet info successfully"
    });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const getWalletInfoByAdmin = async (req, res, next) => {
  try {
    const user = req.user;
    if (user.role_id === "customer") {
      return res.status(403).json({
        code: 403,
        message: "You do not have permission to use this function",
      });
    }

    const { uid } = req.params;
    const walletService = require("../services/wallet.service");
    const walletData = await walletService.getWalletInfo(uid);
    return res.status(200).json({
      code: 200,
      data: walletData,
      message: "Get user wallet info successfully"
    });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

module.exports = {
  detailProfile,
  resetPassword,
  editProfile,
  uploadAvatar,
  allUser,
  createAccountStaff,
  changeActiveUser,
  changeActiveStaff,
  changeRestrictBuy,
  changeRestrictCod,
  getWalletInfo,
  getWalletInfoByAdmin,
};

