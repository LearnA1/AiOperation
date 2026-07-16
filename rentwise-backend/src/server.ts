import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { webhookRouter } from "./routes/webhooks";
import { apiRouter } from "./routes/api";
import { pollGmailOnce } from "./jobs/pollGmail";
import { devRouter } from "./routes/dev";

const app = express();

// Twilio posts application/x-www-form-urlencoded; Gmail polling doesn't
// need a body parser since it's outbound. JSON is for our own API.
app.use("/webhooks/twilio", express.urlencoded({ extended: false }));
app.use("/api", express.json());
app.use("/dev", express.json());

app.use("/webhooks", webhookRouter);
app.use("/api", apiRouter);
app.use("/dev", devRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Poll Gmail every minute — but only if Gmail credentials are actually
// set. Without this guard, the cron job would throw every 60 seconds
// during local/demo testing before Gmail is wired up.
if (process.env.GMAIL_REFRESH_TOKEN) {
  cron.schedule("* * * * *", () => {
    pollGmailOnce().catch((err) => console.error("Gmail poll failed:", err));
  });
} else {
  console.log("GMAIL_REFRESH_TOKEN not set — Gmail polling disabled for now.");
}

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`RentWise backend listening on :${port}`));
