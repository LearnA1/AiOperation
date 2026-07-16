// Same palette as the original mock -- purely visual, unrelated to the
// data-wiring changes in this file.
export const C = {
  sidebarBg: "#16302A",
  navActiveBg: "#2E6B50",
  navText: "#B9CEC3",
  navActiveText: "#FFFFFF",
  page: "#F3F1EA",
  card: "#FFFFFF",
  cream: "#FCF8E8",
  creamBorder: "#EDE3B8",
  border: "#E3E0D3",
  ink: "#1B1B17",
  muted: "#79766C",
  rustBg: "#F4DCC9",
  rustText: "#AE5A34",
  mintBg: "#DCF1E0",
  mintText: "#1E7A48",
  amberBg: "#FBE7C4",
  amberText: "#8F5A19",
  amberSolid: "#E08E3E",
  greyBg: "#EAE7DD",
  greyText: "#726F65",
};

export const CATEGORY_LABEL = {
  billing: "Billing",
  maintenance: "Maintenance",
  leasing: "Leasing",
  general: "General",
};

export const TRUST_LEVEL_LABEL = {
  AUTOMATE: "Automate",
  ASK_FIRST: "Ask first",
  NEVER: "Never",
};

export function initials(name) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function timeAgo(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

// A conversation can technically have more than one Action over time;
// today's pipeline creates exactly one per inbound message, but this
// picks the most recent regardless, rather than assuming array order.
export function primaryAction(conv) {
  if (!conv.actions || conv.actions.length === 0) return null;
  return [...conv.actions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

const STATUS_STYLE = {
  PENDING_APPROVAL: (forceManual) => ({
    label: forceManual ? "Escalated" : "Needs Review",
    bg: C.amberBg,
    text: C.amberText,
  }),
  APPROVED: () => ({ label: "Sending…", bg: C.mintBg, text: C.mintText }),
  EXECUTED: () => ({ label: "Sent", bg: C.mintBg, text: C.mintText }),
  REJECTED: () => ({ label: "Dismissed", bg: C.greyBg, text: C.greyText }),
  FAILED: () => ({ label: "Send Failed", bg: C.rustBg, text: C.rustText }),
};

export function statusOf(conv) {
  const action = primaryAction(conv);
  if (!action) return { label: "No action yet", bg: C.greyBg, text: C.greyText };
  const style = STATUS_STYLE[action.status];
  return style ? style(action.forceManual) : { label: action.status, bg: C.greyBg, text: C.greyText };
}
