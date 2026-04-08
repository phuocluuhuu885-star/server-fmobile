const admin = require('firebase-admin');

const sendNotification = async (fcmToken, title, body,extraData) => {
    if (!fcmToken) return; // Tránh lỗi nếu user không có token

    const message = {
        notification: { title, body },
        // Thêm phần này để hiển thị trên đầu màn hình (Heads-up)
        data: extraData,
        android: {
            notification: {
                channelId: "shop_notification_channel", // Trùng với ID trong Android
                priority: "high"
            }
        },
        token: fcmToken
    };

    try {
        await admin.messaging().send(message);
        console.log('Gửi thông báo thành công');
    } catch (error) {
        console.error('Lỗi gửi thông báo:', error);
    }
};

module.exports = { sendNotification };