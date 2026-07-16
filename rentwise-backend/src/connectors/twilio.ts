// Twilio connector
//
// Responsibility: get tenant texts IN via webhook, and send approved
// replies OUT. Same rule as Gmail — this file never decides what to send.
//
// Setup: point the property's existing business number's "A message
// comes in" webhook at POST /webhooks/twilio (see src/routes/webhooks.ts).
// If they can't port the number, Twilio can also front a new number that
// forwards from their existing line — see the discovery notes in README.

import twilio from "twilio";
import type { Request } from "express";

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export interface InboundSms {
  externalId: string; // Twilio MessageSid
  fromPhone: string;
  body: string;
  receivedAt: Date;
}

/**
 * Validates the request actually came from Twilio (not a spoofed POST),
 * then normalizes it into our internal shape.
 */
export function verifyAndParseWebhook(req: Request): InboundSms | null {
  const signature = req.header("X-Twilio-Signature") ?? "";
  const url = `${process.env.PUBLIC_BASE_URL}/webhooks/twilio`;
  const isValid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN as string, signature, url, req.body);

  if (!isValid) return null;

  return {
    externalId: req.body.MessageSid,
    fromPhone: req.body.From,
    body: req.body.Body,
    receivedAt: new Date(),
  };
}

/**
 * Sends an approved SMS. Called ONLY by the action executor, and ONLY
 * after an Action of type SEND_REPLY or NOTIFY_VENDOR has status APPROVED.
 */
export async function sendSms(to: string, body: string): Promise<string> {
  const message = await client.messages.create({
    to,
    from: process.env.TWILIO_FROM_NUMBER,
    body,
  });
  return message.sid;
}
