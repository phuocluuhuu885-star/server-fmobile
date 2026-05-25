var express = require("express");
var router = express.Router();
const controller = require("../controllers/account.controller");
const middleware = require("../middleware/auth.middleware");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const { cloudinary } = require("../config/SetupCloudinary");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "user",
    format: "png",
  },
});

const upload = multer({ storage });

router.get(
  "/detail-profile/:uid",
  middleware.checkToken,
  controller.detailProfile
);
router.put("/edit-profile/:uid", middleware.checkToken, controller.editProfile);
router.put(
  "/change-password/:uid",
  middleware.checkToken,
  controller.resetPassword
);

router.put(
  "/upload-avatar/:uid",
  middleware.checkToken,
  upload.single("avatar"),
  controller.uploadAvatar
);

// dành cho admin hoặc staff
router.get("/customers", middleware.checkToken, controller.allUser);
router.post(
  "/create-staff",
  middleware.checkToken,
  controller.createAccountStaff
);
router.put(
  "/change-active-account/:uid",
  middleware.checkToken,
  controller.changeActiveUser
);
router.put(
  "/change-restrict-buy/:uid",
  middleware.checkToken,
  controller.changeRestrictBuy
);
router.put(
  "/change-restrict-cod/:uid",
  middleware.checkToken,
  controller.changeRestrictCod
);
router.delete(
  "/delete-staff-account/:staffId",
  middleware.checkToken,
  controller.changeActiveStaff
);
router.get("/wallet", middleware.checkToken, controller.getWalletInfo);
router.get(
  "/wallet/:uid",
  middleware.checkToken,
  controller.getWalletInfoByAdmin
);

module.exports = router;
