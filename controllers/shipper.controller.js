const shipperModel = require("../models/Shipper");

const getAllShippers = async (req, res) => {
  try {
    const keyword = (req.query.keyword || "").trim();
    const query = keyword
      ? {
          $or: [
            { name: { $regex: keyword, $options: "i" } },
            { phone_number: { $regex: keyword, $options: "i" } },
            { shipper_code: { $regex: keyword, $options: "i" } },
            { shipping_company: { $regex: keyword, $options: "i" } },
          ],
        }
      : {};

    const result = await shipperModel.shipper.find(query).sort({ createdAt: -1 });
    return res.status(200).json({
      code: 200,
      result,
      message: "get shippers successfully",
    });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

const createShipper = async (req, res) => {
  try {
    const { name, phone_number, shipper_code, shipping_company } = req.body;
    if (!name || !phone_number || !shipper_code || !shipping_company) {
      return res.status(400).json({
        code: 400,
        message: "Missing required fields: name, phone_number, shipper_code, shipping_company",
      });
    }

    const exist = await shipperModel.shipper.findOne({
      shipper_code: shipper_code.trim(),
    });
    if (exist) {
      return res.status(409).json({ code: 409, message: "shipper code already exists" });
    }

    const newShipper = await shipperModel.shipper.create({
      name: name.trim(),
      phone_number: phone_number.trim(),
      shipper_code: shipper_code.trim(),
      shipping_company: shipping_company.trim(),
    });

    return res.status(201).json({
      code: 201,
      result: newShipper,
      message: "created shipper successfully",
    });
  } catch (error) {
    return res.status(500).json({ code: 500, message: error.message });
  }
};

module.exports = {
  getAllShippers,
  createShipper,
};
