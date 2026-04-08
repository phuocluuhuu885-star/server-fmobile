const express = require("express");
const router = express.Router();
const voucherController = require("../controllers/voucher.controller");
const middleware = require("../middleware/auth.middleware"); // Import middleware gác cổng

// Bất kỳ ai đã đăng nhập mới được xem danh sách voucher
router.get("/get-list", middleware.checkToken, voucherController.list);

// Các quyền can thiệp vào hệ thống (Nên có thêm checkAdmin nếu bạn có phân quyền)
router.post("/add", middleware.checkToken, voucherController.addVoucher);
router.put("/edit/:id", middleware.checkToken, voucherController.editVoucher);
router.delete("/delete", middleware.checkToken, voucherController.deleteVoucher);
router.get("/voucher-by-product/:productId", voucherController.getVoucherByProduct);
router.post("/voucher-by-forcart", voucherController.getVouchersForCart);

module.exports = router;