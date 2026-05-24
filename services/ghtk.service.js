const axios = require("axios");

const GHTK_BASE_URL =
  process.env.GHTK_BASE_URL || "https://services-staging.ghtklab.com";

function getGhtkHeaders() {
  const token = process.env.GHTK_TOKEN;
  const partner = process.env.GHTK_PARTNER;
  if (!token) {
    const err = new Error("Thiếu GHTK_TOKEN trong biến môi trường");
    err.code = "GHTK_CONFIG";
    throw err;
  }
  const headers = {
    Token: token,
    "Content-Type": "application/json",
  };
  if (partner) {
    headers["X-Client-Source"] = partner;
  }
  return headers;
}

/**
 * Tạo vận đơn GHTK.
 * @param {{ products: Array, order: Object }} payload
 */
async function createOrderGHTK(payload) {
  const { data } = await axios.post(
    `${GHTK_BASE_URL}/services/shipment/order/?ver=1.5`, // <-- Đã sửa thành API V2 chuẩn mới
    payload,
    { headers: getGhtkHeaders(), timeout: 30000 }
  );

  if (data.success) {
    return data;
  }

  if (data.error && data.error.code === "ORDER_ID_EXIST" && data.error.ghtk_label) {
    return {
      success: true,
      message: data.message,
      order: {
        partner_id: data.error.partner_id,
        label: data.error.ghtk_label,
        fee: data.order?.fee || "0",
        status_id: data.error.status,
      },
      existed: true,
    };
  }

  const err = new Error(data.message || "GHTK tạo đơn thất bại");
  err.code = data.error_code || data.error?.code || "GHTK_ERROR";
  err.ghtkResponse = data;
  throw err;
}
// /**
//  * Tạo vận đơn GHTK (Đã Mock dữ liệu thành công để làm đồ án).
//  * @param {{ products: Array, order: Object }} payload
//  */
// async function createOrderGHTK(payload) {
//   // Bỏ qua đoạn gọi axios để không bị lỗi 404/401 nữa
//   console.log("=== HỆ THỐNG ĐANG MOCK ĐƠN HÀNG GHTK ĐỂ DEMO ===");
//   console.log("Dữ liệu nhận được:", payload);

//   // Tự tạo một mã vận đơn giả lập dạng GHTK để lưu vào database
//   const mockTrackingCode = "GHTK_MOCK_" + Math.random().toString(36).substr(2, 9).toUpperCase();

//   // Trả về đúng cấu trúc dữ liệu thành công mà hàm confirmOrder của bạn đang cần
//   return {
//     success: true,
//     message: "Xác nhận đơn và tạo vận đơn GHTK thành công (Mock)",
//     order: {
//       partner_id: payload.order?.id || "mock_id",
//       label: mockTrackingCode, // Mã vận đơn giả lập
//       fee: 35000, // Tiền ship giả lập 35k
//       status_id: "2", // Trạng thái: Đã tiếp nhận đơn hàng
//     },
//     existed: false
//   };
// }

/**
 * Tra cứu trạng thái vận đơn (label hoặc partner order id).
 * @param {string} trackingOrder - Mã label GHTK hoặc partner order id
 */
async function getTracking(trackingOrder) {
  const encoded = encodeURIComponent(trackingOrder);
  const { data } = await axios.get(
    `${GHTK_BASE_URL}/services/shipment/v2/${encoded}`,
    { headers: getGhtkHeaders(), timeout: 30000 }
  );

  if (!data.success) {
    const err = new Error(data.message || "Không lấy được tracking GHTK");
    err.code = "GHTK_TRACKING_ERROR";
    err.ghtkResponse = data;
    throw err;
  }

  return data;
}

function pickEnv(name, fallback = "") {
  return (process.env[name] || fallback).trim();
}

/**
 * Map đơn nội bộ + địa chỉ giao hàng → payload GHTK.
 */
function buildGhtkPayload(orderDoc, infoDoc, productLines, deliveryOverride = {}) {
  const orderId = String(orderDoc._id);
  const totalPrice = Math.round(orderDoc.total_price || 0);
  const isCod = orderDoc.payment_method === 1 && !orderDoc.payment_status;
  const pickMoney = isCod ? totalPrice : 0;

  const products = productLines.map((line, index) => ({
    name: line.name || `San pham ${index + 1}`,
    weight: line.weight || 0.3,
    quantity: line.quantity || 1,
    product_code: line.product_code || String(line.option_id || index + 1),
  }));

  const ghtkOrder = {
    id: orderId,
    pick_name: pickEnv("GHTK_PICK_NAME", "Shop"),
    pick_address: pickEnv("GHTK_PICK_ADDRESS"),
    pick_province: pickEnv("GHTK_PICK_PROVINCE"),
    pick_district: pickEnv("GHTK_PICK_DISTRICT"),
    pick_ward: pickEnv("GHTK_PICK_WARD", ""),
    pick_tel: pickEnv("GHTK_PICK_TEL"),
    pick_email: pickEnv("GHTK_PICK_EMAIL", "shop@example.com"),
    name: infoDoc.name,
    tel: infoDoc.phone_number,
    email: deliveryOverride.email || pickEnv("GHTK_DELIVER_EMAIL", "customer@example.com"),
    address: infoDoc.address,
    province:
      deliveryOverride.province ||
      pickEnv("GHTK_DELIVER_PROVINCE", "Hà Nội"),
    district:
      deliveryOverride.district ||
      pickEnv("GHTK_DELIVER_DISTRICT", "Huyện Hoài Đức"),
    ward: deliveryOverride.ward || pickEnv("GHTK_DELIVER_WARD", ""),
    hamlet: deliveryOverride.hamlet || "Khác",
    is_freeship: isCod ? "0" : "1",
    pick_money: pickMoney,
    value: totalPrice > 0 ? totalPrice : 100000,
    // note: deliveryOverride.note || `Don hang ${orderId}`,
    // Thêm dòng này hoặc sửa lại dòng note để đánh dấu đơn test:
    note: `【ĐƠN TEST HỆ THỐNG】 - Không giao hàng - ${deliveryOverride.note || orderId}`,
  };

  return { products, order: ghtkOrder };
}

/** Mã trạng thái GHTK phổ biến (staging/production). */
const GHTK_STATUS_LABELS = {
  "-1": "Đã hủy",
  1: "Chưa tiếp nhận",
  2: "Đã tiếp nhận",
  3: "Đã lấy hàng",
  4: "Đang giao hàng",
  5: "Đã giao hàng",
  6: "Đã đối soát",
  7: "Không lấy được hàng",
  8: "Hoãn lấy hàng",
  9: "Không giao được",
  10: "Delay giao hàng",
  11: "Đã đối soát công nợ",
  12: "Đã điều phối lấy hàng",
  20: "Đang trả hàng",
  21: "Đã trả hàng",
  45: "Shipper báo đã giao",
};

const DELIVERED_STATUS_IDS = new Set(["5", "6", "45"]);

function formatGhtkStatus(status, statusText) {
  const id = status != null ? String(status).trim() : "";
  const text = statusText != null ? String(statusText).trim() : "";
  if (text) return text;
  if (id && GHTK_STATUS_LABELS[id]) return GHTK_STATUS_LABELS[id];
  return id || "Chưa có dữ liệu";
}

function isGhtkDelivered(ghtkOrder = {}) {
  const id = String(ghtkOrder.status ?? "").trim();
  const text = String(ghtkOrder.status_text ?? ghtkOrder.statusText ?? "").toLowerCase();
  if (DELIVERED_STATUS_IDS.has(id)) return true;
  return /đã giao|da giao|delivered|hoàn tất|hoan tat/.test(text);
}

/**
 * Hủy vận đơn GHTK.
 * @param {string} trackingOrder - Mã label GHTK hoặc mã đơn hàng đối tác
 */
async function cancelOrderGHTK(trackingOrder) {
  if (!trackingOrder) {
    return { success: false, message: "Mã vận đơn trống" };
  }

  const trimmedTracking = trackingOrder.trim();

  // Kiểm tra nếu là mã mock/test cục bộ thì bỏ qua gọi API thực tế
  if (trimmedTracking.startsWith("GHTK_MOCK_")) {
    console.log(`[GHTK MOCK] Bỏ qua API thực tế, hủy đơn hàng giả lập: ${trimmedTracking}`);
    return { success: true, message: "Hủy đơn hàng thành công (Mock)" };
  }

  const encoded = encodeURIComponent(trimmedTracking);
  const headers = getGhtkHeaders();

  console.log(`[GHTK] Gửi yêu cầu hủy vận đơn: ${trimmedTracking} tới ${GHTK_BASE_URL}`);

  const { data } = await axios.post(
    `${GHTK_BASE_URL}/services/shipment/cancel/${encoded}`,
    {},
    { headers, timeout: 30000 }
  );

  return data;
}

module.exports = {
  createOrderGHTK,
  getTracking,
  buildGhtkPayload,
  formatGhtkStatus,
  isGhtkDelivered,
  cancelOrderGHTK,
  GHTK_STATUS_LABELS,
};
