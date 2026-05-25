const accountModel = require("../models/account");
const walletTransactionModel = require("../models/WalletTransaction");
const db = require("../config/ConnectDB");

/**
 * Nạp tiền vào Ví F.
 * @param {string} userId - ID tài khoản người dùng
 * @param {number} amount - Số tiền nạp
 * @param {string} transId - Mã giao dịch đối soát (từ Sepay)
 */
async function topUpWallet(userId, amount, transId) {
  if (amount <= 0) {
    throw new Error("Số tiền nạp phải lớn hơn 0");
  }

  // Chống xử lý trùng giao dịch nạp tiền
  if (transId) {
    const existingTrans = await walletTransactionModel.walletTransaction.findOne({
      type: "deposit",
      trans_id: transId
    });
    if (existingTrans) {
      console.log(`[Ví F] Giao dịch nạp tiền ${transId} đã được xử lý trước đó. Bỏ qua.`);
      return { success: true, message: "Transaction already processed", duplicate: true };
    }
  }

  // Cộng số dư ví bằng atomic update
  const updatedUser = await accountModel.account.findByIdAndUpdate(
    userId,
    { $inc: { wallet_balance: amount } },
    { new: true }
  );

  if (!updatedUser) {
    throw new Error("Không tìm thấy tài khoản người dùng");
  }

  // Tạo transaction log
  const tx = new walletTransactionModel.walletTransaction({
    user_id: userId,
    type: "deposit",
    amount: amount,
    description: `Nạp tiền vào ví F qua QR Sepay`,
    trans_id: transId
  });
  await tx.save();

  console.log(`[Ví F] Nạp thành công +${amount}đ vào ví User ID: ${userId}. Số dư mới: ${updatedUser.wallet_balance}đ`);
  return { success: true, balance: updatedUser.wallet_balance };
}

/**
 * Thanh toán đơn hàng bằng Ví F.
 * @param {string} userId - ID người mua
 * @param {number} totalPrice - Tổng tiền đơn hàng
 * @param {string} orderId - ID đơn hàng
 */
async function payWithWallet(userId, totalPrice, orderId) {
  if (totalPrice <= 0) {
    throw new Error("Số tiền thanh toán phải lớn hơn 0");
  }

  // Trừ tiền ví một cách an toàn bằng cách kiểm tra số dư trực tiếp trong câu query (atomic check)
  const updatedUser = await accountModel.account.findOneAndUpdate(
    { _id: userId, wallet_balance: { $gte: totalPrice } },
    { $inc: { wallet_balance: -totalPrice } },
    { new: true }
  );

  if (!updatedUser) {
    const user = await accountModel.account.findById(userId);
    if (!user) throw new Error("Không tìm thấy tài khoản người dùng");
    throw new Error("Số dư ví F không đủ, vui lòng nạp thêm");
  }

  // Ghi log giao dịch ví
  const tx = new walletTransactionModel.walletTransaction({
    user_id: userId,
    type: "payment",
    amount: totalPrice,
    description: `Thanh toán đơn hàng ${orderId}`,
    order_id: orderId
  });
  await tx.save();

  console.log(`[Ví F] Trừ thành công -${totalPrice}đ cho đơn hàng ${orderId}. Số dư mới: ${updatedUser.wallet_balance}đ`);
  return { success: true, balance: updatedUser.wallet_balance };
}

/**
 * Tự động hoàn tiền vào Ví F khi hủy đơn hàng đã thanh toán.
 * @param {object} order - Đối tượng order document
 */
async function refundOrderToWallet(order) {
  if (!order) return { success: false, message: "Order not found" };

  // Chỉ hoàn tiền khi đơn hàng đã thanh toán
  if (!order.payment_status) {
    console.log(`[Ví F] Đơn hàng ${order._id} chưa thanh toán, bỏ qua hoàn tiền.`);
    return { success: false, message: "Order is not paid" };
  }

  // Kiểm tra chống hoàn tiền trùng lặp cho đơn này
  const existingRefund = await walletTransactionModel.walletTransaction.findOne({
    order_id: order._id,
    type: "refund"
  });

  if (existingRefund) {
    console.log(`[Ví F] Đơn hàng ${order._id} đã được hoàn tiền ví trước đó. Bỏ qua.`);
    return { success: true, message: "Already refunded", alreadyRefunded: true };
  }

  // Cộng lại tiền vào tài khoản
  const updatedUser = await accountModel.account.findByIdAndUpdate(
    order.user_id,
    { $inc: { wallet_balance: order.total_price } },
    { new: true }
  );

  if (!updatedUser) {
    console.error(`[Ví F] Lỗi hoàn tiền: Không tìm thấy user ${order.user_id}`);
    return { success: false, message: "User not found" };
  }

  // Ghi log giao dịch hoàn tiền
  const tx = new walletTransactionModel.walletTransaction({
    user_id: order.user_id,
    type: "refund",
    amount: order.total_price,
    description: `Hoàn tiền hủy đơn hàng ${order._id}`,
    order_id: order._id
  });
  await tx.save();

  console.log(`[Ví F] Hoàn thành công +${order.total_price}đ (Hoàn đơn ${order._id}) cho User ID: ${order.user_id}. Số dư mới: ${updatedUser.wallet_balance}đ`);
  return { success: true, balance: updatedUser.wallet_balance };
}

/**
 * Lấy lịch sử giao dịch ví và số dư của user.
 * @param {string} userId - ID người dùng
 */
async function getWalletInfo(userId) {
  const user = await accountModel.account.findById(userId);
  if (!user) {
    throw new Error("Không tìm thấy tài khoản người dùng");
  }

  const transactions = await walletTransactionModel.walletTransaction
    .find({ user_id: userId })
    .sort({ createdAt: -1 })
    .lean();

  return {
    balance: user.wallet_balance || 0,
    transactions: transactions
  };
}

module.exports = {
  topUpWallet,
  payWithWallet,
  refundOrderToWallet,
  getWalletInfo
};
