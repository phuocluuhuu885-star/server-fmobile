var express = require("express");
var router = express.Router();
var middleware = require("../middleware/auth.middleware");
var controller = require("../controllers/shipper.controller");

router.get("/", middleware.checkToken, controller.getAllShippers);
router.post("/create", middleware.checkToken, controller.createShipper);

module.exports = router;
