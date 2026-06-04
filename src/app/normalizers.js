import { CASE_TYPES, CHANNELS, DECISION_TYPES, DEFAULT_CONFIG, ROLES, STATUSES } from "./constants.js";

function currentDateISO() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeBootstrap(payload) {
  const data = payload || {};
  return {
    config: normalizeConfig(data.config),
    orders: extractArray(data, "orders").map(normalizeOrder),
    cases: extractArray(data, "cases").map(normalizeCase),
    notifications: extractArray(data, "notifications").map(normalizeNotification),
    auditLog: extractArray(data, "auditLog").map(normalizeAuditEntry),
    users: extractArray(data, "users").map(normalizeUser),
    today: data.today || currentDateISO(),
  };
}
export function emptyBootstrap() {
  return {
    config: { ...DEFAULT_CONFIG },
    orders: [],
    cases: [],
    notifications: [],
    auditLog: [],
    users: [],
    today: new Date().toISOString().slice(0, 10),
  };
}
export function normalizeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    complaintDeadlineDays: Number(config.complaintDeadlineDays ?? DEFAULT_CONFIG.complaintDeadlineDays),
    returnDeadlineDays: Number(config.returnDeadlineDays ?? DEFAULT_CONFIG.returnDeadlineDays),
    alertThresholdDays: Number(config.alertThresholdDays ?? DEFAULT_CONFIG.alertThresholdDays),
    staleEscalationDays: Number(config.staleEscalationDays ?? DEFAULT_CONFIG.staleEscalationDays),
  };
}
export function normalizeOrder(order = {}) {
  return {
    number: order.number || order.orderNumber || "-",
    customerName: order.customerName || order.customer?.name || "-",
    email: order.email || order.customer?.email || "-",
    phone: order.phone || order.customer?.phone || "",
    product: order.product || order.productName || order.products?.[0]?.name || "-",
    category: order.category || order.products?.[0]?.category || "-",
    purchasedAt: order.purchasedAt || order.purchaseDate || "",
  };
}
export function normalizeCase(item = {}) {
  const number = item.number || item.caseNumber || item.nr || "-";
  const history = extractArray(item, "history").length
    ? extractArray(item, "history")
    : extractArray(item, "statusHistory");
  return {
    id: String(item.id || item.uuid || number),
    number,
    type: item.type || CASE_TYPES.COMPLAINT,
    channel: item.channel || CHANNELS.ONLINE,
    status: item.status || STATUSES.NEW,
    priority: item.priority || "NORMALNY",
    orderNumber: item.orderNumber || item.order?.number || "",
    customerName: item.customerName || item.customer?.name || "-",
    email: item.email || item.customer?.email || "",
    phone: item.phone || item.customer?.phone || "",
    product: item.product || item.productName || item.order?.product || item.order?.products?.[0]?.name || "-",
    category: item.category || item.order?.category || item.order?.products?.[0]?.category || "-",
    description: item.description || "",
    reason: item.reason || "",
    attachments: normalizeAttachments(item.attachments),
    createdAt: item.createdAt || item.created_at || "",
    deadlineAt: item.deadlineAt || item.deadline || item.termAt || "",
    assignedTo: item.assignedTo || item.assignee?.name || null,
    decision: item.decision ? normalizeDecision(item.decision) : null,
    returnLabel: normalizeReturnLabel(item.returnLabel || item.returnShipment || item.shipment),
    history: history.map(normalizeHistoryItem),
    escalations: extractArray(item, "escalations").map(normalizeEscalation),
  };
}
export function normalizeDecision(decision = {}) {
  return {
    id: String(decision.id || ""),
    type: decision.type || DECISION_TYPES.REPAIR,
    justification: decision.justification || "",
    author: decision.author || decision.authorName || decision.user?.name || "-",
    createdAt: decision.createdAt || decision.approvedAt || decision.created_at || "",
    final: Boolean(decision.final ?? decision.approvedAt ?? true),
  };
}
export function normalizeReturnLabel(label) {
  if (!label) return null;
  return {
    id: String(label.id || ""),
    courier: label.courier || label.carrier || "-",
    trackingNumber: label.trackingNumber || label.tracking || "-",
    format: label.format || "PDF",
    generatedAt: label.generatedAt || label.createdAt || "",
  };
}
export function normalizeHistoryItem(item = {}) {
  return {
    status: item.status || item.newStatus || STATUSES.NEW,
    actor: item.actor || item.actorName || item.user?.name || "System",
    comment: item.comment || item.details || "",
    createdAt: item.createdAt || item.changedAt || item.created_at || "",
  };
}
export function normalizeEscalation(item = {}) {
  return {
    id: String(item.id || ""),
    reason: item.reason || item.comment || "Eskalacja",
    author: item.author || item.actor || item.user?.name || "System",
    createdAt: item.createdAt || item.created_at || "",
  };
}
export function normalizeNotification(item = {}) {
  return {
    id: String(item.id || ""),
    type: item.type || item.trigger || item.channel || "INFO",
    caseNumber: item.caseNumber || item.number || item.case?.number || "-",
    body: item.body || item.message || item.payload || "",
    recipient: item.recipient || item.email || item.phone || "-",
    createdAt: item.createdAt || item.created_at || "",
  };
}
export function normalizeAuditEntry(item = {}) {
  return {
    id: String(item.id || ""),
    action: item.action || item.event || "AUDIT",
    actor: item.actor || item.actorName || item.user?.name || "System",
    details: item.details || item.message || item.description || "",
    createdAt: item.createdAt || item.created_at || "",
  };
}
export function normalizeUser(user = {}) {
  return {
    id: String(user.id || user.uuid || user.email || ""),
    name: user.name || user.fullName || user.email || "-",
    email: user.email || "",
    role: user.role || ROLES.CLIENT,
    active: Boolean(user.active ?? user.enabled ?? true),
  };
}
export function normalizeReport(report = {}) {
  const source = report.report || report.data?.report || report;
  return {
    total: Number(source.total ?? source.summary?.total ?? 0),
    acceptedPercent: Number(source.acceptedPercent ?? source.summary?.acceptedPercent ?? 0),
    rejectedPercent: Number(source.rejectedPercent ?? source.summary?.rejectedPercent ?? 0),
    averageResolutionDays: Number(source.averageResolutionDays ?? source.summary?.averageResolutionDays ?? 0),
    topReasons: extractArray(source, "topReasons").map((item) => ({
      reason: item.reason || item.name || "-",
      count: Number(item.count || 0),
    })),
    byStatus: source.byStatus || source.statuses || {},
    byType: source.byType || source.types || {},
  };
}
export function emptyReport() {
  return {
    total: 0,
    acceptedPercent: 0,
    rejectedPercent: 0,
    averageResolutionDays: 0,
    topReasons: [],
    byStatus: {},
    byType: {},
  };
}
export function extractArray(payload, key) {
  const value = payload?.[key];
  if (Array.isArray(value)) return value;
  if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}
export function extractCase(payload) {
  if (!payload) return null;
  if (payload.case) return payload.case;
  if (payload.zgloszenie) return payload.zgloszenie;
  if (payload.data?.case) return payload.data.case;
  if (payload.data?.zgloszenie) return payload.data.zgloszenie;
  if (payload.id || payload.number || payload.caseNumber) return payload;
  return null;
}
export function normalizeAttachments(attachments) {
  if (Array.isArray(attachments)) {
    return attachments.map((item) => (typeof item === "string" ? item : item.name || item.filename || "")).filter(Boolean);
  }
  return String(attachments || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
export function casePayload(data) {
  return {
    type: data.type,
    channel: data.channel || CHANNELS.ONLINE,
    orderNumber: data.orderNumber,
    email: data.email,
    phone: data.phone,
    reason: data.reason,
    description: data.description,
    attachments: normalizeAttachments(data.attachments),
  };
}
