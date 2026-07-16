// AI understanding layer.
//
// Turns a raw inbound message into structured fields + a proposed action.
// This is the ONLY place in the codebase that calls the LLM. It never
// sends anything itself — it hands its output to the approval engine.

import Anthropic from "@anthropic-ai/sdk";

// Constructed lazily, only when a real (non-stub) extraction call happens —
// so the server can boot and the stub path can run with no key set at all.
let anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!anthropic) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

export interface ExtractionResult {
  category: "billing" | "maintenance" | "leasing" | "general";
  urgent: boolean;
  safetyCritical: boolean; // gas smell, no heat in freezing weather, etc — always force manual review
  confidence: number; // 0-100
  draftReply: string;
  proposedAction:
    | { type: "SEND_REPLY" }
    | { type: "CREATE_SERVICE_REQUEST"; vendorCategory: string }
    | { type: "NOTIFY_MANAGER" };
}

const SYSTEM_PROMPT = `You are the message-understanding layer for a property management AI assistant.
Given a raw tenant message, extract structured data as JSON only — no prose, no markdown fences.

Return exactly this shape:
{
  "category": "billing" | "maintenance" | "leasing" | "general",
  "urgent": boolean,
  "safetyCritical": boolean,
  "confidence": number (0-100, your genuine confidence that the category and draft reply below are correct and safe to send without human review),
  "draftReply": string (a short, warm, accurate reply to send the tenant),
  "proposedAction": { "type": "SEND_REPLY" } | { "type": "CREATE_SERVICE_REQUEST", "vendorCategory": string } | { "type": "NOTIFY_MANAGER" }
}

Mark safetyCritical true for anything involving gas smell, fire, no heat/AC in extreme weather,
carbon monoxide, active flooding, or a break-in — these always require a human regardless of confidence.
Never invent policy details (late fees, lease terms) you were not given as context.`;

// DEMO STUB — no API key required.
// Set USE_STUB_EXTRACTION=true in .env to skip the real Anthropic call
// entirely and use simple keyword rules instead. This lets you run the
// full pipeline (webhook -> approval -> executor -> audit log) end to
// end with zero API cost. Flip it off once you're ready to test real
// AI understanding.
function stubExtractMessage(rawMessage: string): ExtractionResult {
  const text = rawMessage.toLowerCase();

  // Match "gas" and "smell"/"leak" independently, not just the exact
  // phrase "gas smell" -- real messages say "smell gas", "gas leak",
  // "smells like gas", etc. and all of those must still force manual
  // review.
  const gasHazard = /\bgas\b/.test(text) && /(smell|leak|odor)/.test(text);
  const safetyCritical = gasHazard || /carbon monoxide|\bfire\b|flooding|break-?in/.test(text);
  const maintenance = /leak|broken|repair|ac\b|air condition|heat|plumb|maintenance|sink|toilet|appliance/.test(text);
  const billing = /rent|balance|pay|fee|invoice|credit|charge/.test(text);
  const leasing = /lease|renew|move[- ]?out|move[- ]?in/.test(text);
  const urgent = safetyCritical || /urgent|emergency|asap|immediately|no heat|no ac/.test(text);

  const category: ExtractionResult["category"] = safetyCritical || maintenance ? "maintenance" : billing ? "billing" : leasing ? "leasing" : "general";

  const confidence = safetyCritical ? 20 : maintenance ? 75 : billing ? 82 : leasing ? 40 : 60;

  const draftReply = safetyCritical
    ? "We've flagged this as an emergency and a property manager will contact you immediately."
    : maintenance
    ? "We've logged your maintenance request and are matching you with an available vendor."
    : billing
    ? "Thanks for reaching out about your account — here's what we found."
    : leasing
    ? "Lease terms should be confirmed by a property manager — we've flagged this for review."
    : "Thanks for your message — we'll follow up shortly.";

  const proposedAction: ExtractionResult["proposedAction"] =
    category === "maintenance" ? { type: "CREATE_SERVICE_REQUEST", vendorCategory: "general" } : { type: "SEND_REPLY" };

  return { category, urgent, safetyCritical, confidence, draftReply, proposedAction };
}

export async function extractMessage(rawMessage: string, policyContext: string): Promise<ExtractionResult> {
  if (process.env.USE_STUB_EXTRACTION === "true") {
    return stubExtractMessage(rawMessage);
  }

  const response = await getClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Company policy context:\n${policyContext}\n\nTenant message:\n"${rawMessage}"`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Extraction engine returned no text content");
  }

  const cleaned = textBlock.text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as ExtractionResult;
}
