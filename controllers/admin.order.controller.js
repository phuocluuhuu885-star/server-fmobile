const orderModel = require("../models/Orders");
const optionModel = require("../models/Option");
const infoModel = require("../models/Info");
const {
  createOrderGHTK,
  getTracking,
  buildGhtkPayload,
  isGhtkDelivered,
} = require("../services/ghtk.service");

const CONFIRMABLE_STATUSES = ["Chờ xác nhận", "Chờ giao hàng", "Đã thanh toán"];

function assertAdminStaff(req, res) {
  const role = req.user?.role_id;
  if (role !== "admin" && role !== "staff") {
    res.status(403).json({
      code: 403,
      message: "You do not have permission to use this function",
    });
    return false;
  }
  return true;
}

async function buildProductLines(productsOrder) {
  const lines = [];
  for (const item of productsOrder || []) {
    const option = await optionModel.option
      .findById(item.option_id)
      .populate("product_id");
    const productName =
      item.custom_name ||
      option?.product_id?.name ||
      option?.name_color ||
      "San pham";
    const weightKg =
      option?.product_id?.weight > 0
        ? option.product_id.weight / 1000
        : 0.3;
    lines.push({
      name: productName,
      weight: weightKg,
      quantity: item.quantity || 1,
      option_id: item.option_id,
      product_code: String(item.option_id || ""),
    });
  }
  return lines;
}

async function pushAdminLog(orderId, req, action, details, note = "") {
  const adminName = req.user
    ? req.user.username || req.user.full_name || req.user.email || "Admin"
    : "Admin";
  await orderModel.order.findByIdAndUpdate(orderId, {
    $push: {
      admin_update_logs: {
        updated_by: adminName,
        action,
        details,
        note,
        to_time: new Date(),
      },
    },
  });
}

const confirmOrder = async (req, res) => {
  try {
    if (!assertAdminStaff(req, res)) return;

    const { id } = req.params;
    const order = await orderModel.order.findById(id);
    if (!order) {
      return res.status(404).json({ code: 404, message: "order not found" });
    }

    if (order.ghtk?.trackingCode) {
      return res.status(200).json({
        code: 200,
        message: "Đơn đã có mã vận đơn GHTK",
        result: order,
      });
    }

    if (!CONFIRMABLE_STATUSES.includes(order.status)) {
      return res.status(409).json({
        code: 409,
        message: `Không thể xác nhận đơn ở trạng thái "${order.status}"`,
      });
    }

    const info = await infoModel.info.findById(order.info_id);
    if (!info) {
      return res.status(400).json({
        code: 400,
        message: "Thiếu thông tin giao hàng (info_id)",
      });
    }

    const productLines = await buildProductLines(order.productsOrder);
    const payload = buildGhtkPayload(order, info, productLines, req.body || {});
    const ghtkRes = await createOrderGHTK(payload);

    const ghtkOrder = ghtkRes.order || {};
    const label = ghtkOrder.label || ghtkOrder.label_id || "";
    const fee = Number(ghtkOrder.fee || 0);
    const ghtkStatus = String(
      ghtkOrder.status_id != null ? ghtkOrder.status_id : ghtkOrder.status || ""
    );

    const previousStatus = order.status;
    const updatedOrder = await orderModel.order.findByIdAndUpdate(
      id,
      {
        status: "shipping",
        ghtk: {
          trackingCode: label,
          label,
          fee,
          status: ghtkStatus,
        },
      },
      { new: true }
    );

    await pushAdminLog(
      id,
      req,
      "Xác nhận đơn GHTK",
      `${previousStatus} -> shipping | label: ${label}`,
      req.body?.note || ""
    );

    return res.status(200).json({
      code: 200,
      message: ghtkRes.existed
        ? "Đơn GHTK đã tồn tại, đã đồng bộ mã vận đơn"
        : "Xác nhận đơn và tạo vận đơn GHTK thành công",
      result: updatedOrder,
      ghtk: ghtkRes,
    });
  } catch (error) {
    console.error("confirmOrder GHTK:", error.message);
    const status = error.code === "GHTK_CONFIG" ? 500 : 502;
    return res.status(status).json({
      code: status,
      message: error.message,
      ghtk: error.ghtkResponse || undefined,
    });
  }
};

const getOrderTracking = async (req, res) => {
  try {
    if (!assertAdminStaff(req, res)) return;

    const { id } = req.params;
    const order = await orderModel.order.findById(id).populate("info_id");
    if (!order) {
      return res.status(404).json({ code: 404, message: "order not found" });
    }

    const trackingCode =
      order.ghtk?.trackingCode || order.ghtk?.label || "";
    if (!trackingCode) {
      return res.status(404).json({
        code: 404,
        message: "Đơn chưa có mã vận đơn GHTK. Hãy xác nhận đơn trước.",
      });
    }

    const ghtkRes = await getTracking(trackingCode);
    const ghtkOrder = ghtkRes.order || {};
    const syncedStatus = String(
      ghtkOrder.status_text ?? ghtkOrder.status ?? ""
    );
    const ghtkStatusId = String(ghtkOrder.status ?? "");

    const orderPatch = {
      "ghtk.status": syncedStatus || ghtkStatusId,
      "ghtk.fee": Number(ghtkOrder.ship_money || order.ghtk?.fee || 0),
    };

    if (isGhtkDelivered(ghtkOrder) && order.status !== "Đã giao hàng") {
      orderPatch.status = "Đã giao hàng";
      orderPatch.completedAt = new Date();
      await pushAdminLog(
        id,
        req,
        "Đồng bộ GHTK — đã giao",
        `${order.status} -> Đã giao hàng | GHTK: ${orderPatch["ghtk.status"]}`,
        ""
      );
    }

    await orderModel.order.findByIdAndUpdate(id, orderPatch);
    const freshOrder = await orderModel.order.findById(id);

    return res.status(200).json({
      code: 200,
      message: "get tracking successfully",
      result: {
        order: freshOrder,
        ghtk_tracking: ghtkRes,
        ghtk_status_label: syncedStatus || ghtkStatusId,
        delivered: isGhtkDelivered(ghtkOrder),
      },
    });
  } catch (error) {
    console.error("getOrderTracking GHTK:", error.message);
    return res.status(502).json({
      code: 502,
      message: error.message,
      ghtk: error.ghtkResponse || undefined,
    });
  }
};

module.exports = {
  confirmOrder,
  getOrderTracking,
};
