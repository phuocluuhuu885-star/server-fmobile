const Withdrawal = require("../models/Withdrawal");
const accountModel = require("../models/account");
const walletTransactionModel = require("../models/WalletTransaction");
const notifiModel = require("../models/Notification");
const { sendNotification } = require("../config/Fcm");

// Tạo đơn rút tiền
const createRequest = async (req, res, next) => {
  try {
    const { name, bank, bank_code, account_number, amount } = req.body;
    const parsedAmount = Number(amount);

    if (!name || !bank || !bank_code || !account_number || !parsedAmount || parsedAmount < 1000) {
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
      bank_code,
      account_number,
      amount: parsedAmount,
      status: "pending",
      balance_before: updatedUser.wallet_balance + parsedAmount,
      balance_after: updatedUser.wallet_balance
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

    const bill_image = req.file && req.file.path ? req.file.path : null;

    // Khóa trạng thái nguyên tử (Atomic State Lock) - Cho phép cập nhật bill_image khi đơn pending hoặc đã được approved tự động qua webhook
    const withdrawal = await Withdrawal.findOneAndUpdate(
      { _id: id, status: { $in: ["pending", "approved"] } },
      {
        status: "approved",
        bill_image: bill_image,
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

    // Nếu đơn trước đó ở trạng thái pending (chưa được SePay duyệt tự động), gửi thông báo đến user
    if (withdrawal.status === "pending") {
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

// Webhook SePay – xác nhận chuyển khoản rút tiền tự động
const sepayWithdrawalWebhook = async (req, res, next) => {
  try {
    // ── 1. Xác thực API Key ────────────────────────────────────────────
    const authHeader = req.headers["authorization"];
    const apiKey = process.env.SEPAY_WEBHOOK_API_KEY;
    console.log("=== SEPAY WITHDRAWAL WEBHOOK ===");
    console.log("Body:", JSON.stringify(req.body, null, 2));

    if (apiKey && authHeader !== `Apikey ${apiKey}`) {
      console.log("❌ Xác thực thất bại");
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    console.log("✅ Xác thực thành công");

    const { id, transferType, transferAmount, content, referenceCode, transferDate } = req.body;

    // ── 2. Chỉ xử lý giao dịch tiền ra (out) – ngân hàng chuyển tiền đi ─
    // SePay gửi transferType = 'out' khi tài khoản của bạn chuyển tiền đi
    // Nếu đây là loại 'in' (nhận tiền) thì bỏ qua
    if (transferType === "in") {
      return res.status(200).json({ success: true, message: "Ignore incoming transaction" });
    }

    // ── 3. Chống duplicate: kiểm tra sepay_trans_id ───────────────────
    const sepayTransId = `sepay_wd_${id}`;
    const alreadyDone = await Withdrawal.findOne({ sepay_trans_id: sepayTransId });
    if (alreadyDone) {
      return res.status(200).json({ success: true, message: "Transaction already processed" });
    }

    // ── 4. Tìm mã đơn rút tiền trong nội dung CK (hỗ trợ trường hợp ngân hàng cắt ngắn còn 20-24 ký tự hex) ─
    const withdrawalIdMatch = content ? content.match(/RUTTIEN(?:\s+\S+)?\s+([0-9a-fA-F]{20,24})/) : null;
    if (!withdrawalIdMatch) {
      console.log("⚠️  Không tìm thấy mã đơn RUTTIEN trong nội dung:", content);
      return res.status(200).json({ success: true, message: "Not a withdrawal transaction, skipped" });
    }

    const matchedIdStr = withdrawalIdMatch[1];
    console.log("🔎 Mã đơn rút tiền tìm thấy (dạng thô):", matchedIdStr);

    // ── 5. Tìm và khoá đơn (atomic) ──────────────────────────────────
    const paidAmount = Number(transferAmount);
    let query = { status: "pending" };

    // Sử dụng $expr và $toString để so khớp chuỗi ObjectId bị cắt ngắn một cách an toàn mà không bị lỗi Cast to ObjectId
    if (matchedIdStr.length < 24) {
      query.$expr = {
        $regexMatch: {
          input: { $toString: "$_id" },
          regex: `^${matchedIdStr}`,
          options: "i"
        }
      };
    } else {
      query._id = matchedIdStr;
    }

    const withdrawal = await Withdrawal.findOneAndUpdate(
      query,
      {
        status: "approved",
        processed_at: new Date(),
        sepay_trans_id: sepayTransId,
        transaction_id: referenceCode || String(id)
      },
      { new: true }
    );

    if (!withdrawal) {
      // Kiểm tra xem đơn đã được approved/rejected chưa
      let existsQuery = {};
      if (matchedIdStr.length < 24) {
        existsQuery.$expr = {
          $regexMatch: {
            input: { $toString: "$_id" },
            regex: `^${matchedIdStr}`,
            options: "i"
          }
        };
      } else {
        existsQuery._id = matchedIdStr;
      }
      const exists = await Withdrawal.findOne(existsQuery);
      if (!exists) {
        return res.status(404).json({ success: false, message: "Withdrawal not found" });
      }
      return res.status(200).json({ success: true, message: "Withdrawal already processed" });
    }

    const withdrawalId = withdrawal._id;

    // ── 6. Kiểm tra số tiền ──────────────────────────────────────────
    const expectedAmount = Number(withdrawal.amount);
    if (paidAmount < expectedAmount) {
      // Rollback – hoàn lại trạng thái pending nếu tiền không đủ
      await Withdrawal.findByIdAndUpdate(withdrawalId, {
        status: "pending",
        sepay_trans_id: null,
        transaction_id: null,
        processed_at: null
      });
      console.log(`❌ Số tiền không khớp. Cần ${expectedAmount}, nhận ${paidAmount}`);
      return res.status(400).json({
        success: false,
        message: `Số tiền không đủ. Cần ${expectedAmount.toLocaleString("vi-VN")}đ nhưng chỉ nhận ${paidAmount.toLocaleString("vi-VN")}đ`
      });
    }

    console.log(`✅ Đơn rút tiền ${withdrawalId} đã được duyệt tự động.`);

    // ── 7. Gửi thông báo FCM cho user ─────────────────────────────────
    try {
      const requester = await accountModel.account.findById(withdrawal.user_id);
      const title = "💸 Rút tiền thành công";
      const body = `Yêu cầu rút ${withdrawal.amount.toLocaleString("vi-VN")}đ về ${withdrawal.bank} - ${withdrawal.account_number} đã hoàn tất.`;

      const newNoti = new notifiModel.notifi({
        sender_id: withdrawal.user_id,
        receiver_id: withdrawal.user_id,
        content: body,
        order_id: String(withdrawal._id),
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
    } catch (notiErr) {
      console.error("Lỗi gửi thông báo (sepayWithdrawalWebhook):", notiErr);
    }

    // ── 8. Tạo hoá đơn HTML trả về cho admin / lưu log ───────────────
    const transferDateObj = transferDate ? new Date(transferDate) : new Date();
    const timeStr = transferDateObj.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    const dateStr = transferDateObj.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "/");
    const txCode = referenceCode || String(id);
    const amountFormatted = withdrawal.amount.toLocaleString("vi-VN");

    const invoiceHTML = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Hoá đơn rút tiền – ${withdrawal._id}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #f0f4f8; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 24px; }
    .card { background: #fff; border-radius: 20px; max-width: 480px; width: 100%; box-shadow: 0 8px 40px rgba(0,0,0,0.12); overflow: hidden; }
    .header { background: linear-gradient(135deg, #1a56db 0%, #0ea5e9 100%); padding: 32px 28px 24px; text-align: center; }
    .header .icon { width: 56px; height: 56px; background: rgba(255,255,255,0.2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 24px; }
    .header h1 { color: #fff; font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
    .header .subtitle { color: rgba(255,255,255,0.8); font-size: 13px; margin-top: 4px; }
    .body { padding: 28px; }
    .row { display: flex; justify-content: space-between; align-items: flex-start; padding: 14px 0; border-bottom: 1px solid #f0f0f0; gap: 12px; }
    .row:last-of-type { border-bottom: none; }
    .row .label { color: #6b7280; font-size: 13px; font-weight: 500; white-space: nowrap; }
    .row .value { color: #111827; font-size: 14px; font-weight: 600; text-align: right; }
    .amount-row .value { font-size: 20px; color: #1a56db; font-weight: 700; }
    .status-badge { display: inline-block; background: #d1fae5; color: #065f46; font-size: 13px; font-weight: 600; padding: 4px 14px; border-radius: 20px; }
    .divider { border: none; border-top: 2px dashed #e5e7eb; margin: 4px 0; }
    .footer { background: #f9fafb; padding: 20px 28px; text-align: center; color: #9ca3af; font-size: 12px; line-height: 1.6; border-top: 1px solid #f0f0f0; }
    .footer strong { color: #374151; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="icon">💸</div>
      <h1>XÁC NHẬN RÚT TIỀN</h1>
      <p class="subtitle">Giao dịch đã hoàn tất thành công</p>
    </div>
    <div class="body">
      <div class="row">
        <span class="label">Khách hàng</span>
        <span class="value">${withdrawal.name}</span>
      </div>
      <div class="row amount-row">
        <span class="label">Số tiền</span>
        <span class="value">${amountFormatted} VNĐ</span>
      </div>
      <hr class="divider" />
      <div class="row">
        <span class="label">Ngân hàng</span>
        <span class="value">${withdrawal.bank}</span>
      </div>
      <div class="row">
        <span class="label">STK</span>
        <span class="value">${withdrawal.account_number}</span>
      </div>
      <hr class="divider" />
      <div class="row">
        <span class="label">Thời gian CK</span>
        <span class="value">${timeStr} – ${dateStr}</span>
      </div>
      <div class="row">
        <span class="label">Mã giao dịch</span>
        <span class="value">${txCode}</span>
      </div>
      <div class="row">
        <span class="label">Trạng thái</span>
        <span class="value"><span class="status-badge">✓ Thành công</span></span>
      </div>
    </div>
    <div class="footer">
      Cảm ơn quý khách đã sử dụng dịch vụ.<br/>
      <strong>F-Mobile</strong> – Hỗ trợ 24/7
    </div>
  </div>
</body>
</html>`;

    // Lưu invoice vào response data để admin/log system sử dụng
    return res.status(200).json({
      success: true,
      message: "Withdrawal approved successfully via SePay webhook",
      data: {
        withdrawal_id: withdrawal._id,
        customer: withdrawal.name,
        amount: withdrawal.amount,
        bank: withdrawal.bank,
        account_number: withdrawal.account_number,
        transaction_id: txCode,
        processed_at: withdrawal.processed_at,
        invoice_html: invoiceHTML
      }
    });
  } catch (error) {
    console.error("SePay Withdrawal Webhook Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createRequest,
  getUserRequests,
  getAdminRequests,
  approveRequest,
  rejectRequest,
  getDetail,
  sepayWithdrawalWebhook
};
