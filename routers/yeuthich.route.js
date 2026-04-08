var express = require("express");
var router = express.Router();
var controller = require("../controllers/yeuthich.controller");
var middleware = require("../middleware/auth.middleware");

router.post("/themyeuthich", controller.addFavorite);
router.post("/deletefavorite", controller.removeFavorite);
router.post("/checkyeuthich", controller.checkFavoriteExists);
router.get("/checktheoiduser/:user_id", controller.getFavorites);


module.exports = router;