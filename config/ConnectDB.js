const mongoose = require("mongoose");
const dns = require("dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);
mongoose
  .connect(process.env.URL_MONGODB + "FMobileStore")
  .then(() => console.log("connect successfully ✅ !!!"))
  .catch((err) => console.log("connect failed ❌: ", err));
  
module.exports = {
  mongoose,
};

