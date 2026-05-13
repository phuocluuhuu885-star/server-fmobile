const accountModel = require("../models/Account");

const BLACKLIST_THRESHOLD =
	Number(process.env.TRUST_BLACKLIST_THRESHOLD) || 50;

function effectiveTrust(score) {
	return score == null ? 100 : score;
}

function isUserPaymentRestricted(accountDoc) {
	if (!accountDoc) return false;
	if (accountDoc.is_blacklisted === true) return true;
	return effectiveTrust(accountDoc.trust_score) < BLACKLIST_THRESHOLD;
}

async function adjustUserTrustScore(userId, delta) {
	if (!userId) return;
	const acc = await accountModel.account
		.findById(userId)
		.select("trust_score is_blacklisted");
	if (!acc) return;
	const current = effectiveTrust(acc.trust_score);
	const next = Math.max(0, current + delta);
	const is_blacklisted = next < BLACKLIST_THRESHOLD;
	await accountModel.account.findByIdAndUpdate(userId, {
		trust_score: next,
		is_blacklisted,
	});
}

/**
 * @param {import("mongoose").Types.ObjectId} userId
 * @param {string} previousStatus
 * @param {string} newStatus
 */
async function syncTrustAfterOrderStatusChange(userId, previousStatus, newStatus) {
	if (!userId || previousStatus === newStatus) return;

	if (newStatus === "Đã giao hàng" && previousStatus !== "Đã giao hàng") {
		await adjustUserTrustScore(userId, 5);
		return;
	}

	const bomFrom = ["Chờ giao hàng", "Đang giao hàng"];
	if (newStatus === "Đã hủy" && bomFrom.includes(previousStatus)) {
		await adjustUserTrustScore(userId, -50);
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
