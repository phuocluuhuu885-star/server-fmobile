const admin = require('firebase-admin');

const sendNotification = async (fcmToken, title, body, extraData) => {
    if (!fcmToken) return; // Tránh lỗi nếu user không có token

    // FCM yêu cầu tất cả giá trị trong data phải là String
    // Chuyển đổi toàn bộ extraData sang String để tránh lỗi
    const safeData = {};
    if (extraData && typeof extraData === 'object') {
        for (const key of Object.keys(extraData)) {
            const val = extraData[key];
            safeData[key] = (val === null || val === undefined) ? "" : String(val);
        }
    }

    const message = {
        // Dùng data-only payload để onMessageReceived luôn được gọi
        // dù app đang foreground, background, hay bị kill
        data: {
            title: String(title || ""),
            body: String(body || ""),
            ...safeData
        },
        android: {
            priority: "high",
            notification: {
                channelId: "shop_notification_channel",
                sound: "default"
            }
        },
        token: fcmToken
    };

    try {
        const response = await admin.messaging().send(message);
        console.log('Gửi thông báo thành công, messageId:', response);
    } catch (error) {
        console.error('Lỗi gửi thông báo:', error.code, error.message);
    }
};

const sendMulticastNotification = async (fcmTokens, title, body, extraData) => {
    if (!fcmTokens || fcmTokens.length === 0) return;

    // Lọc bỏ các token null/undefined/empty
    const validTokens = fcmTokens.filter(token => token && token.trim() !== "");
    if (validTokens.length === 0) return;

    // FCM yêu cầu tất cả giá trị trong data phải là String
    const safeData = {};
    if (extraData && typeof extraData === 'object') {
        for (const key of Object.keys(extraData)) {
            const val = extraData[key];
            safeData[key] = (val === null || val === undefined) ? "" : String(val);
        }
    }

    const message = {
        data: {
            title: String(title || ""),
            body: String(body || ""),
            ...safeData
        },
        android: {
            priority: "high",
            notification: {
                channelId: "shop_notification_channel",
                sound: "default"
            }
        },
        tokens: validTokens
    };

    try {
        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`${response.successCount}/${validTokens.length} messages were sent successfully`);
        if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    console.error(`Token[${idx}] failed:`, resp.error?.code, resp.error?.message);
                }
            });
        }
    } catch (error) {
        console.error('Lỗi gửi thông báo multicast:', error.code, error.message);
    }
};

module.exports = { sendNotification, sendMulticastNotification };