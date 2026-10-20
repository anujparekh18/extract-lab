import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Keep model names and prices current without anyone editing code.
crons.daily("sync model catalog", { hourUTC: 4, minuteUTC: 17 }, internal.modelCatalog.sync, {});

// Delete endpoint documents past their extractor's retention period.
crons.hourly("delete expired API documents", { minuteUTC: 41 }, internal.endpoint.purgeExpired, {});

export default crons;
