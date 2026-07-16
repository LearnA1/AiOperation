// Gmail connector
//
// Responsibility: get tenant emails IN, and send approved replies OUT.
// Nothing else. It never decides what to send or whether to send it —
// that's the approval engine's job (see src/engine/approval.ts).
//
// Auth: a Google Cloud OAuth2 client + a refresh token for the shared
// mailbox (e.g. maintenance@thecompany.com). Set these in .env — see
// .env.example. This connector is written against googleapis but is not
// run in this environment; wire up real credentials before deploying.

import { google } from "googleapis";

const oauth2Client = new google.auth.OAuth2(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET,
  process.env.GMAIL_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });

const gmail = google.gmail({ version: "v1", auth: oauth2Client });

export interface InboundEmail {
  externalId: string; // Gmail message id
  fromEmail: string;
  subject: string;
  body: string;
  receivedAt: Date;
}

/**
 * Polls for unread messages in the shared inbox since a given historyId.
 * In production this is normally driven by a Gmail push notification
 * (via Cloud Pub/Sub) rather than polling — see README for the watch() setup.
 */
export async function fetchNewEmails(sinceHistoryId?: string): Promise<InboundEmail[]> {
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread -label:rentwise-processed",
    maxResults: 25,
  });

  const messages = list.data.messages ?? [];
  const results: InboundEmail[] = [];

  for (const m of messages) {
    if (!m.id) continue;
    const full = await gmail.users.messages.get({ userId: "me", id: m.id, format: "full" });
    const headers = full.data.payload?.headers ?? [];
    const fromHeader = headers.find((h) => h.name === "From")?.value ?? "";
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "";
    const body = extractPlainTextBody(full.data.payload);

    results.push({
      externalId: m.id,
      fromEmail: parseEmailAddress(fromHeader),
      subject,
      body,
      receivedAt: new Date(Number(full.data.internalDate ?? Date.now())),
    });

    // Mark as processed so we don't re-ingest it on the next poll.
    await gmail.users.messages.modify({
      userId: "me",
      id: m.id,
      requestBody: { addLabelIds: ["RENTWISE_PROCESSED"], removeLabelIds: ["UNREAD"] },
    });
  }

  return results;
}

/**
 * Sends an approved reply. Called ONLY by the action executor, and ONLY
 * after an Action of type SEND_REPLY has status APPROVED.
 */
export async function sendEmailReply(to: string, subject: string, body: string): Promise<string> {
  const raw = buildRawMessage(to, subject, body);
  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
  return res.data.id ?? "";
}

function buildRawMessage(to: string, subject: string, body: string): string {
  const message = [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join("\n");
  return Buffer.from(message).toString("base64url");
}

function parseEmailAddress(fromHeader: string): string {
  const match = fromHeader.match(/<(.+)>/);
  return match ? match[1] : fromHeader.trim();
}

function extractPlainTextBody(payload: any): string {
  if (!payload) return "";
  if (payload.body?.data) return Buffer.from(payload.body.data, "base64").toString("utf-8");
  const part = payload.parts?.find((p: any) => p.mimeType === "text/plain");
  return part?.body?.data ? Buffer.from(part.body.data, "base64").toString("utf-8") : "";
}
