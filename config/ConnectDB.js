const mongoose = require("mongoose");
const dns = require("dns");

dns.setServers(["8.8.8.8", "8.8.4.4"]);
mongoose
  .connect(process.env.URL_MONGODB + "FMobileStore")
  .then(async () => {
    console.log("connect successfully ✅ !!!");

    // One-time migration to fill balance_before and balance_after for old records
    try {
      const Withdrawal = mongoose.models.Withdrawal || mongoose.model("Withdrawal");
      const Account = mongoose.models.account || mongoose.model("account");

      const withdrawals = await Withdrawal.find({
        $or: [
          { balance_before: { $exists: false } },
          { balance_before: null }
        ]
      });

      if (withdrawals.length > 0) {
        console.log(`[Migration] Found ${withdrawals.length} withdrawal records without balance fields. Migrating...`);
        for (const wd of withdrawals) {
          const user = await Account.findById(wd.user_id);
          if (user) {
            const currentBalance = user.wallet_balance || 0;
            if (wd.status === "rejected") {
              wd.balance_before = currentBalance;
              wd.balance_after = currentBalance;
            } else {
              wd.balance_before = currentBalance + wd.amount;
              wd.balance_after = currentBalance;
            }
            await wd.save();
          }
        }
        console.log("[Migration] Migration completed successfully!");
      }
    } catch (err) {
      console.error("[Migration] Error during migration:", err);
    }
  })
  .catch((err) => console.log("connect failed ❌: ", err));

module.exports = {
  mongoose,
};

