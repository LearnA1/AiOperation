// PM software connector
//
// One interface, one concrete implementation. If a future customer runs a
// different system, you write a second class that implements the same
// interface — nothing else in the codebase changes.
//
// This concrete implementation (RestPmsConnector) targets a generic
// REST-based PM system (this shape matches AppFolio's and Buildium's
// public APIs closely enough to be a realistic starting point).
//
// Yardi Voyager specifically does NOT have an open REST API — see
// README.md "Yardi access" section. For a Yardi client, this same
// interface would instead be implemented by a class that talks to the
// client-provisioned Interface Web User's SOAP endpoint (Strategy A from
// our research), or wraps a third-party unifying API. Only that one
// class would need to change — the rest of the system (approval engine,
// executor, audit log) is unaffected.

export interface TenantRecord {
  pmsId: string;
  name: string;
  email?: string;
  phone?: string;
  unitNumber: string;
  unitPmsId: string;
  propertyName: string;
  propertyPmsId: string;
}

export interface ServiceRequestInput {
  unitPmsId: string;
  category: string; // hvac, plumbing, electrical, general
  description: string;
  urgent: boolean;
}

export interface PmsConnector {
  /** Look up a tenant by whichever contact channel triggered the conversation. */
  findTenantByContact(contact: { phone?: string; email?: string }): Promise<TenantRecord | null>;

  /** Write a maintenance/service request into the PM software's system of record. */
  createServiceRequest(input: ServiceRequestInput): Promise<{ pmsRequestId: string }>;
}

export class RestPmsConnector implements PmsConnector {
  private baseUrl = process.env.PMS_API_BASE_URL as string;
  private apiKey = process.env.PMS_API_KEY as string;

  async findTenantByContact(contact: { phone?: string; email?: string }): Promise<TenantRecord | null> {
    const query = contact.phone ? `phone=${encodeURIComponent(contact.phone)}` : `email=${encodeURIComponent(contact.email ?? "")}`;
    const res = await fetch(`${this.baseUrl}/tenants?${query}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;

    const t = data.results[0];
    return {
      pmsId: t.id,
      name: t.full_name,
      email: t.email,
      phone: t.phone,
      unitNumber: t.unit.number,
      unitPmsId: t.unit.id,
      propertyName: t.unit.property.name,
      propertyPmsId: t.unit.property.id,
    };
  }

  async createServiceRequest(input: ServiceRequestInput): Promise<{ pmsRequestId: string }> {
    const res = await fetch(`${this.baseUrl}/service-requests`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        unit_id: input.unitPmsId,
        category: input.category,
        description: input.description,
        priority: input.urgent ? "emergency" : "routine",
        source: "rentwise-ai",
      }),
    });
    if (!res.ok) {
      throw new Error(`PMS service request failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return { pmsRequestId: data.id };
  }
}

export const pmsConnector: PmsConnector = new RestPmsConnector();
