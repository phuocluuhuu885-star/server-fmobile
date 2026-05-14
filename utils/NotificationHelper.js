const accountModel = require("../models/account");
const notiModel = require("../models/Notification");
const { sendNotification } = require("../config/Fcm");

/**
 * Gửi thông báo đến toàn bộ khách hàng
 * @param {string} title Tiêu đề thông báo
 * @param {string} body Nội dung thông báo
 * @param {string} type Loại thông báo (system, promotion, v.v.)
 * @param {string} orderId ID đơn hàng (nếu có)
 */
const notifyAllUsers = async (title, body, type = "system", orderId = "") => {
    try {
        // 1. Lấy tất cả tài khoản là khách hàng
        const users = await accountModel.account.find({ role_id: "customer" });
        
        if (!users || users.length === 0) return;

        // 2. Tạo bản ghi thông báo trong DB và gửi Push cho từng user
        const notificationPromises = users.map(async (user) => {
            // Lưu vào bảng Notification để xem lại trong app
            const newNoti = new notiModel.notifi({
                receiver_id: user._id,
                content: body,
                type: type,
                order_id: orderId,
                status: "unread"
            });
            await newNoti.save();

            // Gửi Push Notification nếu có token
            if (user.fcmToken) {
                await sendNotification(user.fcmToken, title, body, {
                    type: type,
                    orderId: orderId
                });
            }
        });

        // Chạy song song nhưng không đợi tất cả nếu số lượng quá lớn (tùy chọn)
        // Ở đây dùng Promise.all để đảm bảo tính toàn vẹn cho số lượng vừa phải
        await Promise.all(notificationPromises);
        
        console.log(`Đã gửi thông báo cho ${users.length} người dùng.`);
    } catch (error) {
        console.error("Lỗi khi gửi thông báo toàn cục:", error);
    }
};

module.exports = { notifyAllUsers };
