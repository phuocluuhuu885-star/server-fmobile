const Yeuthich = require('../models/yeuthich');

const addFavorite = async (req, res, next) => {
  try {
    const { user_id, product_id } = req.body;

    const newFavorite = new Yeuthich({
      user_id,
      product_id,
    });

    await newFavorite.save();

    return res.status(201).json({ success: true, message: "Thêm sản phẩm vào danh sách yêu thích thành công." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const removeFavorite = async (req, res, next) => {
  try {
    const { user_id, product_id } = req.body;

    const favorite = await Yeuthich.findOneAndRemove({ user_id, product_id });
    if (!favorite) {
      return res.status(404).json({ success: false, message: "Yêu thích không tồn tại." });
    }

    return res.status(200).json({ success: true, message: "Xóa sản phẩm khỏi danh sách yêu thích thành công." });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const checkFavoriteExists = async (req, res, next) => {
  try {
    const { user_id, product_id } = req.body;

    const favorite = await Yeuthich.findOne({ user_id, product_id });
    const exists = !!favorite;

    return res.status(200).json({ exists });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getFavorites = async (req, res, next) => {
  try {
    const { user_id } = req.params;

    const favorites = await Yeuthich.find({ user_id });
    return res.status(200).json(favorites);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  addFavorite,
  removeFavorite,
  checkFavoriteExists,
  getFavorites
};
