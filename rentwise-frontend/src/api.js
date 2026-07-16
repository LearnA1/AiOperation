// Every call here hits the real rentwise-backend API (proxied by Vite's
// dev server, see vite.config.js -- no mock data anywhere in this file).

const API = "/api";
const DEV = "/dev";

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.error || "";
    } catch {
      /* response wasn't JSON -- fine, just use the status text */
    }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  getConversations: () => request(`${API}/conversations`),

  approveAction: (id, editedBody) =>
    request(`${API}/actions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(editedBody ? { editedBody } : {}),
    }),
  rejectAction: (id) => request(`${API}/actions/${id}/reject`, { method: "POST" }),

  getPlaybook: () => request(`${API}/playbook`),
  setPlaybookRule: (actionType, trustLevel) =>
    request(`${API}/playbook/${actionType}`, {
      method: "PUT",
      body: JSON.stringify({ trustLevel }),
    }),

  getSettings: () => request(`${API}/settings`),
  updateSettings: (data) => request(`${API}/settings`, { method: "PUT", body: JSON.stringify(data) }),

  getAudit: (limit = 50) => request(`${API}/audit?limit=${limit}`),
  getTenants: () => request(`${API}/tenants`),
  getPolicy: () => request(`${API}/policy`),

  simulateMessage: (payload) => request(`${DEV}/simulate-message`, { method: "POST", body: JSON.stringify(payload) }),
};
