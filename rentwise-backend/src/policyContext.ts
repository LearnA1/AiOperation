// The same policy text shown in the "Policies" tab of the dashboard.
// Passed into every extraction call so the AI never invents a late-fee
// amount, grace period, or SLA — it can only repeat what's written here.
// In a later version this would be editable per-customer from the
// Policies tab and stored in its own table; hardcoded here to keep the
// pilot scope small.

export const POLICY_CONTEXT = `
- Rent is due on the tenant's lease-specified due day each month. A 5-day grace period applies; no late fee within it.
- Late fee: $75 or 5% of monthly rent, whichever is greater, applied automatically after the grace period. Waivers require manager approval — the AI must never promise a waiver.
- Emergency maintenance (no heat/AC in extreme weather, active leak, gas smell, broken exterior lock) is dispatched to a vendor within 30 minutes. Routine requests are dispatched within 1 business day.
- The AI must never quote a specific lease renewal rate — only a manager can confirm renewal terms.
`.trim();
