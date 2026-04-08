var express = require("express");
var router = express.Router();
var controller = require("../controllers/notification.controller");
var middleware = require("../middleware/auth.middleware");
router.get("/get-notifi-list/:userId", controller.allNotificationByUser);
router.put("/update-status/:notificationId", controller.updateStatusNotifi);
router.post("/postnotifi",middleware.checkToken, controller.createNotification);
router.get("/get-Unread/:userId", controller.countUnreadNotifications);

module.exports = router;