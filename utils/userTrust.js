const accountModel = require("../models/Account");

const BLACKLIST_THRESHOLD =
	Number(process.env.TRUST_BLACKLIST_THRESHOLD) || 50;

function effectiveTrust(score) {
	return score == null ? 150 : score;
}

function isUserPaymentRestricted(accountDoc) {
	if (!accountDoc) return false;
	return accountDoc.is_blacklisted === true;
}

async function adjustUserTrustScore(userId, delta) {
	if (!userId) return;
	const acc = await accountModel.account
		.findById(userId)
		.select("trust_score is_blacklisted");
	if (!acc) return;
	const current = effectiveTrust(acc.trust_score);
	const next = Math.min(150, Math.max(0, current + delta));
	const is_blacklisted = next < BLACKLIST_THRESHOLD;
	await accountModel.account.findByIdAndUpdate(userId, {
		trust_score: next,
		is_blacklisted,
	});
}

/**
 * @param {object|import("mongoose").Types.ObjectId|string} orderOrUserId
 * @param {string} previousStatus
 * @param {string} newStatus
 * @param {string} reason
 * @param {boolean} isCancelledByAdmin
 */
async function syncTrustAfterOrderStatusChange(orderOrUserId, previousStatus, newStatus, reason = "", isCancelledByAdmin = false) {
	if (!orderOrUserId || previousStatus === newStatus) return;

	let userId;
	let orderDoc = null;

	if (orderOrUserId && typeof orderOrUserId === "object" && orderOrUserId.user_id) {
		userId = orderOrUserId.user_id;
		orderDoc = orderOrUserId;
	} else {
		userId = orderOrUserId;
	}

	if (!userId) return;

	// Normalize status names to handle accents case-insensitively/partially
	const normNewStatus = typeof newStatus === 'string' ? newStatus.trim() : "";
	const normPrevStatus = typeof previousStatus === 'string' ? previousStatus.trim() : "";

	const isDelivered = normNewStatus === "Đã giao hàng" || normNewStatus === "Da giao hàng";
	const isCancelled = normNewStatus === "Đã hủy" || normNewStatus === "Da hủy";

	if (isDelivered && normPrevStatus !== "Đã giao hàng" && normPrevStatus !== "Da giao hàng") {
		await adjustUserTrustScore(userId, 10);
		return;
	}

	if (isCancelled) {
		// 1. Luồng mới: Nếu admin hủy đơn sau khi đơn hàng xác nhận và tạo đơn bên ghtk (đã có trackingCode)
		if (isCancelledByAdmin && orderDoc) {
			const hasGhtkCode = orderDoc.ghtk && orderDoc.ghtk.trackingCode && orderDoc.ghtk.trackingCode.trim() !== "";
			if (hasGhtkCode) {
				await adjustUserTrustScore(userId, -50);
				return;
			}
		}

		// Luồng cũ fallback: nếu đơn hàng bị hủy từ trạng thái đang giao/giao hàng
		const bomFrom = ["Chờ giao hàng", "Đang giao hàng", "shipping"];
		if (bomFrom.includes(previousStatus)) {
			await adjustUserTrustScore(userId, -50);
			return;
		}

		// Kiểm tra số lần hủy đơn trong ngày
		if (normPrevStatus !== "Đã hủy" && normPrevStatus !== "Da hủy") {
			const startOfDay = new Date();
			startOfDay.setHours(0, 0, 0, 0);

			const orderModel = require("../models/Orders");
			const cancelledToday = await orderModel.order.countDocuments({
				user_id: userId,
				status: { $in: ["Đã hủy", "Da hủy"] },
				updatedAt: { $gte: startOfDay }
			});

			if (cancelledToday > 5) {
				await adjustUserTrustScore(userId, -10);
			}
		}
	}
}

async function assertCodAllowedForUser(userId) {
	if (!userId) return;
	const acc = await accountModel.account
		.findById(userId)
		.select("trust_score is_blacklisted");
	if (isUserPaymentRestricted(acc)) {
		const err = new Error(
			"Tài khoản cần thanh toán trước 100% (ZaloPay). Không dùng được thanh toán khi nhận hàng."
		);
		err.code = "PAYMENT_RESTRICTED";
		throw err;
	}
}

module.exports = {
	BLACKLIST_THRESHOLD,
	effectiveTrust,
	isUserPaymentRestricted,
	adjustUserTrustScore,
	syncTrustAfterOrderStatusChange,
	assertCodAllowedForUser,
};
