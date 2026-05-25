const Withdrawal = require("../models/Withdrawal");
const accountModel = require("../models/account");
const walletTransactionModel = require("../models/WalletTransaction");
const notifiModel = require("../models/Notification");
const { sendNotification } = require("../config/Fcm");

// Tạo đơn rút tiền
const createRequest = async (req, res, next) => {
  try {
    const { name, bank, account_number, amount } = req.body;
    const parsedAmount = Number(amount);

    if (!name || !bank || !account_number || !parsedAmount || parsedAmount < 1000) {
      return res.status(400).json({
        code: 400,
        message: "Thông tin không hợp lệ hoặc số tiền rút quá nhỏ (tối thiểu 1.000đ)"
      });
    }

    const userId = req.user._id;

    // Trừ số dư ví một cách an toàn bằng atomic update
    const updatedUser = await accountModel.account.findOneAndUpdate(
      { _id: userId, wallet_balance: { $gte: parsedAmount } },
      { $inc: { wallet_balance: -parsedAmount } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(400).json({
        code: 400,
        message: "Số dư ví F-Wallet không đủ để thực hiện yêu cầu rút tiền"
      });
    }

    // Tạo đơn rút tiền mới
    const withdrawal = new Withdrawal({
      user_id: userId,
      name,
      bank,
      account_number,
      amount: parsedAmount,
      status: "pending"
    });
    const savedWithdrawal = await withdrawal.save();

    // Ghi log giao dịch ví
    const tx = new walletTransactionModel.walletTransaction({
      user_id: userId,
      type: "withdraw",
      amount: parsedAmount,
      description: `Yêu cầu rút tiền #${savedWithdrawal._id} về tài khoản ${bank} ${account_number}`,
      withdrawal_id: savedWithdrawal._id
    });
    await tx.save();

    return res.status(201).json({
      code: 201,
      message: "Tạo đơn rút tiền thành công",
      data: savedWithdrawal
    });
  } catch (error) {
    next(error);
  }
};

// Lấy danh sách đơn của user hiện tại
const getUserRequests = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { status } = req.query;
    let query = { user_id: userId };

    if (status === "pending") {
      query.status = "pending";
    } else if (status === "processed") {
      query.status = { $in: ["approved", "rejected"] };
    }

    const requests = await Withdrawal.find(query).sort({ createdAt: -1 });

    return res.status(200).json({
      code: 200,
      message: "Lấy danh sách đơn rút tiền thành công",
      data: requests
    });
  } catch (error) {
    next(error);
  }
};

// Lấy danh sách đơn dành cho Admin
const getAdminRequests = async (req, res, next) => {
  try {
    const { status } = req.query;
    let query = {};

    if (status === "pending") {
      query.status = "pending";
    } else if (status === "processed") {
      query.status = { $in: ["approved", "rejected"] };
    }

    const requests = await Withdrawal.find(query)
      .populate("user_id", "email username avatar wallet_balance")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      code: 200,
      message: "Lấy danh sách đơn rút tiền của hệ thống thành công",
      data: requests
    });
  } catch (error) {
    next(error);
  }
};

// Duyệt đơn rút tiền (Upload ảnh hóa đơn)
const approveRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const adminId = req.user._id;

    if (!req.file || !req.file.path) {
      return res.status(400).json({
        code: 400,
        message: "Vui lòng tải lên ảnh hóa đơn chuyển khoản"
      });
    }

    const bill_image = req.file.path;

    // Khóa trạng thái nguyên tử (Atomic State Lock)
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        status: "approved",
        bill_image: bill_image,
        processed_by: adminId,
        processed_at: new Date()
      },
      { new: true }
    );

    if (!withdrawal) {
      return res.status(400).json({
        code: 400,
        message: "Đơn rút tiền không tồn tại hoặc đã được xử lý trước đó"
      });
    }

    // Gửi thông báo đến user
    const requester = await accountModel.account.findById(withdrawal.user_id);
    const title = "💸 Đơn rút tiền đã được duyệt";
    const body = `Đơn rút tiền đã được duyệt thành công +${withdrawal.amount.toLocaleString("vi-VN")}đ`;

    const newNoti = new notifiModel.notifi({
      sender_id: adminId,
      receiver_id: withdrawal.user_id,
      content: body,
      order_id: String(withdrawal._id), // map với intent app android
      status: "unread",
      type: "withdraw"
    });
    await newNoti.save();

    if (requester && requester.fcmToken) {
      await sendNotification(requester.fcmToken, title, body, {
        order_id: String(withdrawal._id),
        type: "withdraw",
        status: "approved"
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Duyệt đơn rút tiền thành công",
      data: withdrawal
    });
  } catch (error) {
    next(error);
  }
};

// Từ chối đơn rút tiền
const rejectRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rejection_reason } = req.body;
    const adminId = req.user._id;

    if (!rejection_reason || rejection_reason.trim() === "") {
      return res.status(400).json({
        code: 400,
        message: "Vui lòng nhập lý do từ chối đơn rút tiền"
      });
    }

    // Khóa trạng thái nguyên tử (Atomic State Lock) - trả về document gốc để lấy số tiền
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: id, status: "pending" },
      {
        status: "rejected",
        rejection_reason: rejection_reason,
        processed_by: adminId,
        processed_at: new Date()
      },
      { new: false }
    );

    if (!withdrawal) {
      return res.status(400).json({
        code: 400,
        message: "Đơn rút tiền không tồn tại hoặc đã được xử lý trước đó"
      });
    }

    // Hoàn trả tiền về ví của user
    await accountModel.account.findByIdAndUpdate(
      withdrawal.user_id,
      { $inc: { wallet_balance: withdrawal.amount } }
    );

    // Ghi log giao dịch hoàn tiền ví
    const refundTx = new walletTransactionModel.walletTransaction({
      user_id: withdrawal.user_id,
      type: "refund",
      amount: withdrawal.amount,
      description: `Hoàn tiền do từ chối đơn rút tiền #${withdrawal._id}`,
      withdrawal_id: withdrawal._id
    });
    await refundTx.save();

    // Gửi thông báo đến user
    const requester = await accountModel.account.findById(withdrawal.user_id);
    const title = "❌ Đơn của bạn bị từ chối";
    const body = `Đơn rút tiền của bạn bị từ chối. Lý do: ${rejection_reason}`;

    const newNoti = new notifiModel.notifi({
      sender_id: adminId,
      receiver_id: withdrawal.user_id,
      content: body,
      order_id: String(withdrawal._id), // map với intent app android
      status: "unread",
      type: "withdraw"
    });
    await newNoti.save();

    if (requester && requester.fcmToken) {
      await sendNotification(requester.fcmToken, title, body, {
        order_id: String(withdrawal._id),
        type: "withdraw",
        status: "rejected"
      });
    }

    return res.status(200).json({
      code: 200,
      message: "Từ chối đơn rút tiền thành công",
      data: {
        ...withdrawal.toObject(),
        status: "rejected",
        rejection_reason
      }
    });
  } catch (error) {
    next(error);
  }
};

// Lấy chi tiết một đơn rút tiền
const getDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    const request = await Withdrawal.findById(id).populate("user_id", "email username avatar wallet_balance");
    if (!request) {
      return res.status(404).json({ code: 404, message: "Đơn rút tiền không tồn tại" });
    }
    return res.status(200).json({ code: 200, message: "Thành công", data: request });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createRequest,
  getUserRequests,
  getAdminRequests,
  approveRequest,
  rejectRequest,
  getDetail
};
