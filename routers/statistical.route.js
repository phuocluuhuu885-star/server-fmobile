var express = require("express");
var router = express.Router();
var statisticalController = require("../controllers/statistical.controller");

router.get("/get-revenue-all-time", statisticalController.calculateRevenueAllTime);
router.get("/get-revenue-by-month", statisticalController.calculateRevenueByMonth);
router.get("/get-sold-quantity-by-productandstore", statisticalController.calculateSoldQuantityByProductAndStore);
router.get("/get-top-store-by-revenue", statisticalController.getTopStoreByRevenue);
router.get("/get-top-product-by-revenue", statisticalController.getTopProductByRevenue);
router.get("/get-revenue-all-store-by-month", statisticalController.revenueAllStoreByMonth);
router.get("/get-revenue-all-store-by-quarter", statisticalController.revenueAllStoreByQuarter);
router.get("/get-top-products-by-sold-quantity", statisticalController.getTopSellingProducts);
router.get("/get-top-users-by-sold-quantity", statisticalController.getTopUsersWithMostSuccessfulOrders);
router.get("/get-successful-orders",statisticalController.getSuccessfulOrders);
router.get("/get-total-revenue",statisticalController.getTotalRevenue);
router.get("/get-top-least-selling-products", statisticalController.getTopLeastSellingProducts)
module.exports = router;

