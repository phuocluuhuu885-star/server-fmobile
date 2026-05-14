const admin = require('firebase-admin');

const sendNotification = async (fcmToken, title, body, extraData) => {
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

const sendMulticastNotification = async (fcmTokens, title, body, extraData) => {
    if (!fcmTokens || fcmTokens.length === 0) return;

    // Lọc bỏ các token null/undefined/empty
    const validTokens = fcmTokens.filter(token => token && token.trim() !== "");
    if (validTokens.length === 0) return;

    const message = {
        notification: { title, body },
        data: extraData,
        android: {
            notification: {
                channelId: "shop_notification_channel",
                priority: "high"
            }
        },
        tokens: validTokens
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`${response.successCount} messages were sent successfully`);
    } catch (error) {
        console.error('Lỗi gửi thông báo multicast:', error);
    }
};

module.exports = { sendNotification, sendMulticastNotification };