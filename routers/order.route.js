var express = require("express");
var router = express.Router();
var controller = require("../controllers/order.controller");
var middleware = require("../middleware/auth.middleware");

router.post("/create-order", middleware.checkToken, controller.createOrder);
router.post("/create-order-by-zalo", middleware.checkToken, controller.createOrderByZalo);


router.put(
  "/update-order/:orderId",
  middleware.checkToken,
  controller.updateOrder
);

router.put(
  "/update-order-status/:orderId",
  middleware.checkToken,
  controller.updateOrderStatus
);

router.post("/creat-eorder", middleware.checkToken, controller.createOrderDefault);
router.post("/zalo-callback", middleware.checkToken, controller.zlCallback);

router.get("/", middleware.checkToken, controller.getOrdersByUserId);
router.get("/orders", middleware.checkToken, controller.getAllOrder);

router.delete("/delete/:id", middleware.checkToken, controller.deleteOrder);

router.get(
  "/detail-order/:orderId",
  middleware.checkToken,
  controller.detailOrders
);

router.get(
  "/cancel-order/:orderId",
  middleware.checkToken,
  controller.cancelOrder
);

module.exports = router;