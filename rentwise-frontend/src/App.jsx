import { useEffect, useMemo, useRef, useState } from "react";
import {
  Inbox as InboxIcon,
  Users,
  FileText,
  CalendarDays,
  Settings as SettingsIcon,
  Search,
  AlertTriangle,
  Send,
  X,
  ChevronLeft,
  ChevronRight,
  Bot,
  Sparkles,
  Building2,
  ListChecks,
  ScrollText,
  RefreshCw,
} from "lucide-react";
import { api } from "./api.js";
import { C, CATEGORY_LABEL, TRUST_LEVEL_LABEL, initials, timeAgo, primaryAction, statusOf } from "./lib.js";

// A handful of realistic example messages the "Simulate Message" button
// cycles through -- unlike the original mock, this actually POSTs to
// /dev/simulate-message and runs the real pipeline (extraction -> playbook
// -> action -> executor), not a client-side fake conversation.
const SIMULATE_EXAMPLES = [
  "The garbage disposal is jammed and making a loud noise.",
  "There's a strong gas smell near the stove, I'm a little worried.",
  "Can I set up a payment plan for my balance?",
  "Do you allow a small dog under 20lbs?",
  "My kitchen sink is leaking pretty badly under the cabinet.",
  "Just confirming my rent balance is $0 before the 1st.",
];

export default function App() {
  const [view, setView] = useState("inbox");

  // ---- conversations (polled) ----
  const [conversations, setConversations] = useState([]);
  const [convLoading, setConvLoading] = useState(true);
  const [convError, setConvError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [draftEdit, setDraftEdit] = useState(null); // { actionId, text }
  const [busyActionId, setBusyActionId] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const simIndex = useRef(0);

  async function loadConversations() {
    try {
      const data = await api.getConversations();
      setConversations(data);
      setConvError(null);
    } catch (err) {
      setConvError(err.message);
    } finally {
      setConvLoading(false);
    }
  }

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!selectedId && conversations.length > 0) setSelectedId(conversations[0].id);
  }, [conversations, selectedId]);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      if (urgentOnly && !c.urgent) return false;
      if (!q) return true;
      const urgentMatch = ("urgent".includes(q) || q.includes("urg")) && c.urgent;
      const haystack = `${c.tenant?.name || ""} ${c.tenant?.unit?.unitNumber || ""} ${CATEGORY_LABEL[c.category] || c.category} ${c.messages
        .map((m) => m.body)
        .join(" ")}`.toLowerCase();
      return haystack.includes(q) || urgentMatch;
    });
  }, [conversations, search, urgentOnly]);

  const pendingCount = conversations.filter((c) => primaryAction(c)?.status === "PENDING_APPROVAL").length;

  async function approveAndSend(conv) {
    const action = primaryAction(conv);
    if (!action) return;
    const edited = draftEdit && draftEdit.actionId === action.id ? draftEdit.text : undefined;
    setBusyActionId(action.id);
    try {
      await api.approveAction(action.id, edited);
      setDraftEdit(null);
      await loadConversations();
    } catch (err) {
      alert(`Couldn't approve this action:\n${err.message}`);
    } finally {
      setBusyActionId(null);
    }
  }

  async function reject(conv) {
    const action = primaryAction(conv);
    if (!action) return;
    setBusyActionId(action.id);
    try {
      await api.rejectAction(action.id);
      await loadConversations();
    } catch (err) {
      alert(`Couldn't reject this action:\n${err.message}`);
    } finally {
      setBusyActionId(null);
    }
  }

  async function simulateMessage() {
    setSimulating(true);
    const message = SIMULATE_EXAMPLES[simIndex.current % SIMULATE_EXAMPLES.length];
    simIndex.current += 1;
    try {
      const result = await api.simulateMessage({ message });
      await loadConversations();
      setSelectedId(result.conversationId);
      setView("inbox");
    } catch (err) {
      alert(`Simulate failed:\n${err.message}`);
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className="flex h-full w-full min-h-[720px]" style={{ background: C.page, color: C.ink, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <Sidebar view={view} setView={setView} pendingCount={pendingCount} />
      <div className="flex-1 overflow-y-auto">
        {convError && (
          <div className="mx-8 mt-6 p-3.5 rounded-lg text-sm" style={{ background: C.rustBg, color: C.rustText }}>
            Can't reach the backend ({convError}). Is it running? Try <code className="font-mono">./run.sh</code> in{" "}
            <code className="font-mono">rentwise-backend-4-2</code>, then reload this page.
          </div>
        )}

        {view === "inbox" && (
          <InboxView
            conversations={filtered}
            loading={convLoading}
            selected={selected}
            setSelectedId={setSelectedId}
            search={search}
            setSearch={setSearch}
            urgentOnly={urgentOnly}
            setUrgentOnly={setUrgentOnly}
            draftEdit={draftEdit}
            setDraftEdit={setDraftEdit}
            approveAndSend={approveAndSend}
            reject={reject}
            busyActionId={busyActionId}
            simulateMessage={simulateMessage}
            simulating={simulating}
          />
        )}
        {view === "playbook" && <PlaybookView />}
        {view === "tenants" && <TenantsView />}
        {view === "calendar" && <CalendarView />}
        {view === "policies" && <PoliciesView />}
        {view === "audit" && <AuditView />}
        {view === "settings" && <SettingsView />}
      </div>
    </div>
  );
}

// ---------- sidebar ----------
function Sidebar({ view, setView, pendingCount }) {
  const items = [
    { id: "inbox", label: "Inbox", icon: InboxIcon, badge: pendingCount },
    { id: "playbook", label: "Playbook", icon: ListChecks },
    { id: "tenants", label: "Tenants", icon: Users },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "policies", label: "Policies", icon: FileText },
    { id: "audit", label: "Audit Trail", icon: ScrollText },
    { id: "settings", label: "Settings", icon: SettingsIcon },
  ];
  return (
    <div className="w-64 shrink-0 flex flex-col" style={{ background: C.sidebarBg }}>
      <div className="flex items-center gap-2 px-5 py-6">
        <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: C.navActiveBg }}>
          <Building2 size={18} color="#fff" />
        </div>
        <span className="text-white font-bold text-lg tracking-tight">RentWise</span>
      </div>
      <nav className="flex-1 px-3 space-y-1">
        {items.map((it) => {
          const Icon = it.icon;
          const active = view === it.id;
          return (
            <button
              key={it.id}
              onClick={() => setView(it.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{ background: active ? C.navActiveBg : "transparent", color: active ? C.navActiveText : C.navText }}
            >
              <Icon size={17} />
              <span className="flex-1 text-left">{it.label}</span>
              {!!it.badge && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: C.amberSolid, color: "#241706" }}
                >
                  {it.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="px-5 py-4 flex items-center gap-2 text-xs" style={{ color: C.navText, opacity: 0.8 }}>
        <span className="w-2 h-2 rounded-full" style={{ background: "#5FD08A" }} />
        Connected to live backend
      </div>
    </div>
  );
}

// ---------- small shared bits ----------
function LoadingRow() {
  return (
    <div className="flex items-center gap-2 text-sm py-10 justify-center" style={{ color: C.muted }}>
      <RefreshCw size={14} className="animate-spin" /> Loading…
    </div>
  );
}

function ErrorNote({ message }) {
  return (
    <div className="p-3.5 rounded-lg text-sm" style={{ background: C.rustBg, color: C.rustText }}>
      {message}
    </div>
  );
}

// ---------- inbox ----------
function InboxView({
  conversations,
  loading,
  selected,
  setSelectedId,
  search,
  setSearch,
  urgentOnly,
  setUrgentOnly,
  draftEdit,
  setDraftEdit,
  approveAndSend,
  reject,
  busyActionId,
  simulateMessage,
  simulating,
}) {
  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Inbox</h1>
          <p className="text-sm font-mono mt-1" style={{ color: C.muted }}>Live tenant conversations</p>
        </div>
        <button
          onClick={simulateMessage}
          disabled={simulating}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: C.sidebarBg }}
        >
          <Sparkles size={15} /> {simulating ? "Sending…" : "Simulate Message"}
        </button>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-white" style={{ border: `1px solid ${C.border}` }}>
          <Search size={16} color={C.muted} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by tenant, unit, or type 'urgent'..."
            className="flex-1 outline-none text-sm bg-transparent"
          />
          {search && (
            <button onClick={() => setSearch("")}>
              <X size={14} color={C.muted} />
            </button>
          )}
        </div>
        <button
          onClick={() => setUrgentOnly((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium"
          style={{
            background: urgentOnly ? C.rustBg : "white",
            color: urgentOnly ? C.rustText : C.muted,
            border: `1px solid ${urgentOnly ? C.rustText : C.border}`,
          }}
        >
          <AlertTriangle size={14} /> Urgent
        </button>
      </div>

      <div className="grid grid-cols-[340px_1fr] gap-5" style={{ minHeight: 560 }}>
        <div className="space-y-2 overflow-y-auto pr-1" style={{ maxHeight: 640 }}>
          {loading && <LoadingRow />}
          {!loading && conversations.length === 0 && (
            <div className="text-sm py-10 text-center" style={{ color: C.muted }}>
              No conversations yet. Try "Simulate Message."
            </div>
          )}
          {conversations.map((c) => {
            const status = statusOf(c);
            const lastMsg = c.messages[c.messages.length - 1];
            const active = selected && selected.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="w-full text-left p-3.5 rounded-xl transition-colors"
                style={{ background: active ? C.cream : C.card, border: `1px solid ${active ? C.creamBorder : C.border}` }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white" style={{ background: C.sidebarBg }}>
                      {initials(c.tenant?.name)}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{c.tenant?.name || "Unknown tenant"}</div>
                      <div className="text-xs" style={{ color: C.muted }}>
                        Unit {c.tenant?.unit?.unitNumber || "?"} · {c.channel}
                      </div>
                    </div>
                  </div>
                  {c.urgent && <AlertTriangle size={14} color={C.rustText} />}
                </div>
                <div className="text-xs truncate mb-2" style={{ color: C.muted }}>{lastMsg?.body}</div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: status.bg, color: status.text }}>
                    {status.label}
                  </span>
                  <span className="text-[10px]" style={{ color: C.muted }}>{timeAgo(c.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-xl p-6" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          {selected ? (
            <ConversationThread
              key={selected.id}
              conv={selected}
              draftEdit={draftEdit}
              setDraftEdit={setDraftEdit}
              approveAndSend={approveAndSend}
              reject={reject}
              busyActionId={busyActionId}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-sm" style={{ color: C.muted }}>
              Select a conversation to view its full history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationThread({ conv, draftEdit, setDraftEdit, approveAndSend, reject, busyActionId }) {
  const status = statusOf(conv);
  const action = primaryAction(conv);
  const pending = action?.status === "PENDING_APPROVAL";
  const busy = action && busyActionId === action.id;
  const editingText = draftEdit && action && draftEdit.actionId === action.id ? draftEdit.text : action?.payload?.body || "";

  return (
    <div>
      <div className="flex items-center justify-between mb-5 pb-4" style={{ borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div className="text-lg font-bold">
            {conv.tenant?.name || "Unknown tenant"} · Unit {conv.tenant?.unit?.unitNumber || "?"}
          </div>
          <div className="text-xs font-mono mt-0.5" style={{ color: C.muted }}>
            {CATEGORY_LABEL[conv.category] || conv.category} · via {conv.channel} · {timeAgo(conv.updatedAt)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {action && (pending || action.status === "FAILED") && (
            <span className="text-xs" style={{ color: C.muted }}>Confidence: {action.confidence}%</span>
          )}
          <span className="text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: status.bg, color: status.text }}>
            {status.label}
          </span>
        </div>
      </div>

      <div className="space-y-3 mb-5">
        {conv.messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
      </div>

      {action?.forceReason && pending && (
        <div className="text-xs italic mb-4 px-3 py-2 rounded-lg" style={{ background: C.amberBg, color: C.amberText }}>
          {action.forceReason}
        </div>
      )}

      {action?.status === "FAILED" && (
        <div className="text-xs mb-4 px-3 py-2 rounded-lg" style={{ background: C.rustBg, color: C.rustText }}>
          Send failed: {action.failureReason || "unknown error"}. This is expected if real Twilio/Gmail/PMS credentials aren't set up yet.
        </div>
      )}

      {pending && action && (
        <div className="rounded-lg p-4" style={{ background: C.cream, border: `1px solid ${C.creamBorder}` }}>
          <div className="flex items-center gap-2 mb-2">
            <Bot size={14} color={C.amberSolid} />
            <span className="text-xs font-semibold" style={{ color: C.muted }}>Draft reply — awaiting your review</span>
          </div>
          <textarea
            value={editingText}
            onChange={(e) => setDraftEdit({ actionId: action.id, text: e.target.value })}
            rows={3}
            className="w-full text-sm rounded-md p-2.5 outline-none resize-none"
            style={{ background: "white", border: `1px solid ${C.creamBorder}` }}
          />
          <div className="flex items-center justify-end gap-2 mt-3">
            <button
              onClick={() => reject(conv)}
              disabled={busy}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
              style={{ background: "white", border: `1px solid ${C.border}`, color: C.ink }}
            >
              <X size={14} /> Reject
            </button>
            <button
              onClick={() => approveAndSend(conv)}
              disabled={busy}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: C.amberSolid }}
            >
              <Send size={14} /> {busy ? "Sending…" : "Approve & Send"}
            </button>
          </div>
        </div>
      )}

      {action?.status === "REJECTED" && (
        <div className="text-xs px-3 py-2 rounded-lg" style={{ background: C.greyBg, color: C.greyText }}>
          Rejected — no message was sent for this conversation.
        </div>
      )}
    </div>
  );
}

function MessageBubble({ m }) {
  const isTenant = m.sender === "TENANT";
  const isSystem = m.sender === "SYSTEM";
  if (isSystem) {
    return (
      <div className="text-xs italic px-3 py-2 rounded-lg" style={{ background: C.greyBg, color: C.greyText }}>
        {m.body} <span className="not-italic">· {timeAgo(m.createdAt)}</span>
      </div>
    );
  }
  const label = m.sender === "AI" ? "AI Copilot" : m.sender === "MANAGER" ? "Manager" : "Tenant";
  return (
    <div className={`flex ${isTenant ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[80%]">
        <div className="flex items-center gap-1.5 mb-1" style={{ justifyContent: isTenant ? "flex-start" : "flex-end" }}>
          {!isTenant && <Bot size={12} color={C.amberSolid} />}
          <span className="text-[11px] font-semibold" style={{ color: C.muted }}>{label}</span>
          <span className="text-[11px]" style={{ color: C.muted }}>{timeAgo(m.createdAt)}</span>
        </div>
        <div
          className="text-sm px-3.5 py-2.5 rounded-xl"
          style={{ background: isTenant ? C.greyBg : C.mintBg, color: isTenant ? C.ink : C.mintText }}
        >
          {m.body}
        </div>
      </div>
    </div>
  );
}

// ---------- playbook ----------
function PlaybookView() {
  const [rules, setRules] = useState(null);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);

  async function load() {
    try {
      setRules(await api.getPlaybook());
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function setLevel(rule, trustLevel) {
    setSavingId(rule.id);
    try {
      await api.setPlaybookRule(rule.actionType, trustLevel);
      await load();
    } catch (err) {
      alert(`Couldn't update this rule:\n${err.message}`);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold">Playbook</h1>
      <p className="text-sm font-mono mt-1 mb-6" style={{ color: C.muted }}>
        Set how far each action can go. Changes apply to the very next matching message.
      </p>

      {error && <ErrorNote message={error} />}
      {!rules && !error && <LoadingRow />}

      {rules && (
        <div className="space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-xl p-4 flex items-center justify-between gap-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
              <div>
                <div className="text-sm font-semibold">{rule.label}</div>
                <div className="text-xs mt-1 max-w-md" style={{ color: C.muted }}>{rule.description}</div>
              </div>
              <div className="flex rounded-full p-1 shrink-0" style={{ background: C.page, border: `1px solid ${C.border}` }}>
                {["AUTOMATE", "ASK_FIRST", "NEVER"].map((level) => {
                  const activeLevel = rule.trustLevel === level;
                  const palette =
                    level === "AUTOMATE"
                      ? { bg: C.mintBg, text: C.mintText }
                      : level === "ASK_FIRST"
                      ? { bg: C.amberBg, text: C.amberText }
                      : { bg: C.rustBg, text: C.rustText };
                  return (
                    <button
                      key={level}
                      onClick={() => setLevel(rule, level)}
                      disabled={savingId === rule.id}
                      className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors disabled:opacity-60"
                      style={activeLevel ? { background: palette.bg, color: palette.text } : { color: C.muted }}
                    >
                      {TRUST_LEVEL_LABEL[level]}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs mt-6 italic" style={{ color: C.muted }}>
        Safety-critical reports (gas smell, active leak, no heat in freezing weather) always require a person, regardless of how any rule above is set.
      </p>
    </div>
  );
}

// ---------- tenants ----------
function TenantsView() {
  const [tenants, setTenants] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getTenants().then(setTenants).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">Tenants</h1>
      <p className="text-sm font-mono mt-1 mb-6" style={{ color: C.muted }}>Property management system roster</p>

      {error && <ErrorNote message={error} />}
      {!tenants && !error && <LoadingRow />}

      {tenants && tenants.length === 0 && (
        <div className="text-sm py-10 text-center" style={{ color: C.muted }}>
          No tenants yet — they're created automatically the first time a message comes in from them (via webhook, or "Simulate Message" on the Inbox).
        </div>
      )}

      {tenants && tenants.length > 0 && (
        <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Tenant", "Property & Unit", "Lease Dates", "Rent"].map((h) => (
                  <th key={h} className="px-5 py-3 font-semibold text-xs uppercase tracking-wide" style={{ color: C.muted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td className="px-5 py-4 font-semibold">{t.name}</td>
                  <td className="px-5 py-4">
                    <div>{t.unit?.property?.name || "—"}</div>
                    <div className="text-xs" style={{ color: C.muted }}>Unit {t.unit?.unitNumber}</div>
                  </td>
                  <td className="px-5 py-4 text-xs" style={{ color: C.muted }}>
                    {new Date(t.leaseStart).toLocaleDateString()}<br />to {new Date(t.leaseEnd).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-4">
                    ${t.rent}
                    <div className="text-xs" style={{ color: C.muted }}>Due day {t.dueDay}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- calendar ----------
function CalendarView() {
  const [tenants, setTenants] = useState(null);
  const [error, setError] = useState(null);
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selectedDay, setSelectedDay] = useState(today.getDate());

  useEffect(() => {
    api.getTenants().then(setTenants).catch((err) => setError(err.message));
  }, []);

  const events = useMemo(() => {
    const map = {};
    if (!tenants) return map;
    const add = (day, ev) => {
      if (!map[day]) map[day] = [];
      map[day].push(ev);
    };
    tenants.forEach((t) => {
      if (t.dueDay >= 1 && t.dueDay <= 31) {
        add(t.dueDay, { type: "rent", label: "Rent Due", detail: `${t.name} · Unit ${t.unit?.unitNumber} · $${t.rent}` });
      }
      const end = new Date(t.leaseEnd);
      if (end.getFullYear() === cursor.year && end.getMonth() === cursor.month) {
        add(end.getDate(), { type: "lease", label: "Lease Expires", detail: `${t.name} · Unit ${t.unit?.unitNumber}` });
      }
    });
    return map;
  }, [tenants, cursor]);

  const EVENT_STYLE = {
    rent: { bg: C.mintBg, text: C.mintText },
    lease: { bg: "#E3DCF2", text: "#5B3E9C" },
  };

  const firstDay = new Date(cursor.year, cursor.month, 1).getDay();
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const dayEvents = events[selectedDay] || [];
  const isCurrentMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth();

  function shiftMonth(delta) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">Calendar</h1>
      <p className="text-sm font-mono mt-1 mb-6" style={{ color: C.muted }}>Rent due dates and lease expirations, from real tenant records</p>

      {error && <ErrorNote message={error} />}

      <div className="grid grid-cols-[1fr_320px] gap-6">
        <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-md" style={{ background: C.greyBg }}><ChevronLeft size={16} /></button>
            <div className="font-bold text-lg">{monthLabel}</div>
            <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-md" style={{ background: C.greyBg }}><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 gap-2 mb-2">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="text-xs font-semibold text-center py-1" style={{ color: C.muted }}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {cells.map((day, i) => {
              const evs = day ? events[day] || [] : [];
              const isToday = isCurrentMonth && day === today.getDate();
              const isSelected = day === selectedDay;
              return (
                <button
                  key={i}
                  disabled={!day}
                  onClick={() => day && setSelectedDay(day)}
                  className="rounded-lg p-1.5 text-left align-top"
                  style={{
                    minHeight: 78,
                    background: isSelected ? C.cream : "white",
                    border: `1px solid ${isSelected ? C.creamBorder : C.border}`,
                    opacity: day ? 1 : 0,
                  }}
                >
                  {day && (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold w-5 h-5 rounded-full flex items-center justify-center" style={isToday ? { background: C.sidebarBg, color: "white" } : {}}>
                          {day}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {evs.slice(0, 2).map((e, idx) => (
                          <div key={idx} className="text-[9px] px-1 py-0.5 rounded truncate font-medium" style={{ background: EVENT_STYLE[e.type].bg, color: EVENT_STYLE[e.type].text }}>
                            {e.label}
                          </div>
                        ))}
                        {evs.length > 2 && <div className="text-[9px]" style={{ color: C.muted }}>+{evs.length - 2} more</div>}
                      </div>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="font-bold mb-1">{monthLabel.split(" ")[0]} {selectedDay}, {cursor.year}</div>
          <div className="text-xs font-mono mb-4" style={{ color: C.muted }}>{dayEvents.length} event{dayEvents.length !== 1 ? "s" : ""}</div>
          {dayEvents.length === 0 ? (
            <div className="text-sm" style={{ color: C.muted }}>Nothing scheduled for this day.</div>
          ) : (
            <div className="space-y-3">
              {dayEvents.map((e, i) => (
                <div key={i} className="p-3 rounded-lg" style={{ background: EVENT_STYLE[e.type].bg }}>
                  <div className="text-xs font-bold mb-0.5" style={{ color: EVENT_STYLE[e.type].text }}>{e.label}</div>
                  <div className="text-xs" style={{ color: EVENT_STYLE[e.type].text }}>{e.detail}</div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 pt-4 text-xs italic" style={{ borderTop: `1px solid ${C.border}`, color: C.muted }}>
            Vendor visit scheduling and late-fee tracking aren't wired up in the backend yet — only rent-due and lease-expiration dates shown here are real.
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- policies ----------
function PoliciesView() {
  const [text, setText] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getPolicy().then((r) => setText(r.text)).catch((err) => setError(err.message));
  }, []);

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold">Policies</h1>
      <p className="text-sm font-mono mt-1 mb-6" style={{ color: C.muted }}>
        The policy text the AI is grounded on — it never invents a number outside of this.
      </p>

      {error && <ErrorNote message={error} />}
      {!text && !error && <LoadingRow />}

      {text && (
        <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <pre className="text-sm leading-relaxed whitespace-pre-wrap" style={{ fontFamily: "inherit", color: C.ink }}>{text}</pre>
        </div>
      )}

      <p className="text-xs mt-4 italic" style={{ color: C.muted }}>
        Read-only for now — edit <code className="font-mono">src/policyContext.ts</code> in the backend to change it.
      </p>
    </div>
  );
}

// ---------- audit trail ----------
function AuditView() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setEntries(await api.getAudit(75));
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">Audit Trail</h1>
      <p className="text-sm font-mono mt-1 mb-6" style={{ color: C.muted }}>
        Every message received, every action created, every approval, rejection, and execution — signed and exportable.
      </p>

      {error && <ErrorNote message={error} />}
      {!entries && !error && <LoadingRow />}

      {entries && (
        <div className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ borderBottom: `1px solid ${C.border}` }}>
                {["Time", "Actor", "Action", "Entity"].map((h) => (
                  <th key={h} className="px-5 py-3 font-semibold text-xs uppercase tracking-wide" style={{ color: C.muted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td className="px-5 py-3 text-xs font-mono" style={{ color: C.muted }}>{new Date(e.createdAt).toLocaleString()}</td>
                  <td className="px-5 py-3 text-xs">
                    <span className="font-semibold">{e.actorType}</span>
                    <div style={{ color: C.muted }}>{e.actorId}</div>
                  </td>
                  <td className="px-5 py-3 text-sm font-mono">{e.action}</td>
                  <td className="px-5 py-3 text-xs" style={{ color: C.muted }}>{e.entityType} · {e.entityId.slice(0, 10)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- settings ----------
function SettingsView() {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getSettings().then(setSettings).catch((err) => setError(err.message));
  }, []);

  async function saveThreshold(threshold) {
    setSaving(true);
    try {
      const updated = await api.updateSettings({ mode: settings.mode, threshold });
      setSettings(updated);
    } catch (err) {
      alert(`Couldn't save:\n${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold">Settings</h1>
      <p className="text-sm font-mono mt-1 mb-6" style={{ color: C.muted }}>Confidence safety net</p>

      {error && <ErrorNote message={error} />}
      {!settings && !error && <LoadingRow />}

      {settings && (
        <div className="rounded-xl p-5" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Confidence threshold</span>
            <span className="text-sm font-bold" style={{ color: C.amberText }}>{settings.threshold}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.threshold}
            onChange={(e) => setSettings((s) => ({ ...s, threshold: Number(e.target.value) }))}
            onMouseUp={(e) => saveThreshold(Number(e.target.value))}
            onTouchEnd={(e) => saveThreshold(Number(e.target.value))}
            className="w-full"
            disabled={saving}
          />
          <p className="text-xs mt-3" style={{ color: C.muted }}>
            Used as a safety net for any playbook rule set to <strong>Automate</strong> — if the AI's confidence on a
            given message falls below this, it still gets a manager's review even though the rule allows automation.
            Rules set to <strong>Ask first</strong> or <strong>Never</strong> ignore this entirely. Manage the actual
            per-action rules on the <strong>Playbook</strong> page.
          </p>
        </div>
      )}
    </div>
  );
}
