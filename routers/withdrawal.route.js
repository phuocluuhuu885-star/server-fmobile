var express = require("express");
var router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { cloudinary } = require("../config/SetupCloudinary");
var middleware = require("../middleware/auth.middleware");
var controller = require("../controllers/withdrawal.controller");

// Cấu hình lưu trữ ảnh bill chuyển khoản trên Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "withdrawals",
    format: "png", // hoặc tự động format
  },
});

const upload = multer({ storage });

// User APIs
router.post("/create", middleware.checkToken, controller.createRequest);
router.get("/user", middleware.checkToken, controller.getUserRequests);
router.get("/detail/:id", middleware.checkToken, controller.getDetail);

// Admin APIs
router.get("/admin/all", middleware.checkToken, controller.getAdminRequests);
router.put(
  "/admin/approve/:id",
  middleware.checkToken,
  upload.single("bill"),
  controller.approveRequest
);
router.put("/admin/reject/:id", middleware.checkToken, controller.rejectRequest);

module.exports = router;
