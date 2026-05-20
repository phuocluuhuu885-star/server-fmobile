var express = require("express");
var router = express.Router();
var middleware = require("../middleware/auth.middleware");
var controller = require("../controllers/admin.order.controller");

router.put(
  "/confirm/:id",
  middleware.checkToken,
  controller.confirmOrder
);

router.get(
  "/:id/tracking",
  middleware.checkToken,
  controller.getOrderTracking
);

module.exports = router;
