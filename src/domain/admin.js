import { DECISION_TYPES, ROLES } from "./constants.js";
import { auditEntry, average, countBy, diffDays, makeId, percent, positiveInteger, toISODate } from "./helpers.js";
import { DomainError } from "./errors.js";

export function generateReport(state, filters = {}) {
  const items = state.cases.filter((item) => {
    if (filters.from && item.createdAt < filters.from) return false;
    if (filters.to && item.createdAt > filters.to) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.category && item.category !== filters.category) return false;
    return true;
  });

  const decided = items.filter((item) => item.decision);
  const accepted = decided.filter((item) => item.decision.type !== DECISION_TYPES.REJECT);
  const rejected = decided.filter((item) => item.decision.type === DECISION_TYPES.REJECT);
  const closedDurations = decided.map((item) => diffDays(item.createdAt, item.decision.createdAt));
  const reasonCounts = countBy(items, "reason");

  return {
    total: items.length,
    acceptedPercent: percent(accepted.length, decided.length),
    rejectedPercent: percent(rejected.length, decided.length),
    averageResolutionDays: average(closedDurations),
    topReasons: Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count })),
    byStatus: countBy(items, "status"),
    byType: countBy(items, "type"),
  };
}
export function updateConfiguration(state, patch, actor, now = new Date()) {
  const changedAt = toISODate(now);
  const nextConfig = {
    ...state.config,
    complaintDeadlineDays: positiveInteger(
      patch.complaintDeadlineDays,
      state.config.complaintDeadlineDays,
    ),
    returnDeadlineDays: positiveInteger(patch.returnDeadlineDays, state.config.returnDeadlineDays),
    alertThresholdDays: positiveInteger(patch.alertThresholdDays, state.config.alertThresholdDays),
    staleEscalationDays: positiveInteger(
      patch.staleEscalationDays,
      state.config.staleEscalationDays,
    ),
  };

  return {
    state: {
      ...state,
      config: nextConfig,
      auditLog: [
        auditEntry(
          actor.name,
          "CONFIG_UPDATE",
          `Terminy: reklamacja ${state.config.complaintDeadlineDays}->${nextConfig.complaintDeadlineDays}, zwrot ${state.config.returnDeadlineDays}->${nextConfig.returnDeadlineDays}, alert ${state.config.alertThresholdDays}->${nextConfig.alertThresholdDays}.`,
          changedAt,
        ),
        ...state.auditLog,
      ],
    },
  };
}
export function saveUser(state, input, actor, now = new Date()) {
  const changedAt = toISODate(now);
  const id = input.id || makeId("usr");
  const user = {
    id,
    name: String(input.name || "").trim(),
    email: String(input.email || "").trim().toLowerCase(),
    role: input.role,
    active: Boolean(input.active ?? true),
  };

  if (!user.name || !user.email || !Object.values(ROLES).includes(user.role)) {
    throw new DomainError("INVALID_USER", "Uzytkownik wymaga nazwy, e-maila i roli.");
  }

  const exists = state.users.some((item) => item.id === id);
  const users = exists
    ? state.users.map((item) => (item.id === id ? user : item))
    : [user, ...state.users];

  return {
    state: {
      ...state,
      users,
      auditLog: [
        auditEntry(actor.name, exists ? "USER_UPDATE" : "USER_CREATE", user.email, changedAt),
        ...state.auditLog,
      ],
    },
    user,
  };
}
