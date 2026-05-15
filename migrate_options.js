const mongoose = require("mongoose");
require("dotenv").config();

const URL_MONGODB = process.env.URL_MONGODB + "FMobileStore";

const optionSchema = new mongoose.Schema({
    ram: String,
    storage_capacity: String,
    battery_health: String,
    condition_percent: String,
    is_original: String,
    screen: String
}, { strict: false });

const Option = mongoose.model("option", optionSchema);

const VALID_RAM = ["4GB", "8GB", "12GB", "16GB"];
const VALID_ROM = ["64GB", "128GB", "256GB", "512GB", ">=1TB"];
const VALID_BATTERY = ["<80%", "80% - 90%", ">90%"];
const VALID_CONDITION = ["95%", "98%", "99%"];
const VALID_ORIGINAL = ["Zin nguyên bản", "Không zin"];

async function migrate() {
    try {
        await mongoose.connect(URL_MONGODB);
        console.log("Connected to MongoDB for migration...");

        const options = await Option.find({});
        console.log(`Found ${options.length} options to process.`);

        for (let opt of options) {
            let updated = false;

            // Normalize RAM
            if (!opt.ram || !VALID_RAM.includes(opt.ram)) {
                opt.ram = "8GB"; // Default
                updated = true;
            }

            // Normalize ROM (storage_capacity)
            if (!opt.storage_capacity || !VALID_ROM.includes(opt.storage_capacity)) {
                // Try to fix common formats like "128" -> "128GB"
                if (opt.storage_capacity && VALID_ROM.includes(opt.storage_capacity + "GB")) {
                    opt.storage_capacity = opt.storage_capacity + "GB";
                } else {
                    opt.storage_capacity = "128GB"; // Default
                }
                updated = true;
            }

            // Normalize Battery
            if (!opt.battery_health || !VALID_BATTERY.includes(opt.battery_health)) {
                opt.battery_health = ">90%"; // Default
                updated = true;
            }

            // Normalize Condition
            if (!opt.condition_percent || !VALID_CONDITION.includes(opt.condition_percent)) {
                if (opt.condition_percent && VALID_CONDITION.includes(opt.condition_percent + "%")) {
                    opt.condition_percent = opt.condition_percent + "%";
                } else {
                    opt.condition_percent = "99%"; // Default
                }
                updated = true;
            }

            // Normalize Originality
            if (!opt.is_original || !VALID_ORIGINAL.includes(opt.is_original)) {
                opt.is_original = "Zin nguyên bản"; // Default
                updated = true;
            }

            // Screen
            if (!opt.screen) {
                opt.screen = "6.1 inch Super Retina XDR OLED"; // Default
                updated = true;
            }

            if (updated) {
                await opt.save();
                console.log(`Updated Option ID: ${opt._id}`);
            }
        }

        console.log("Migration completed successfully!");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();
