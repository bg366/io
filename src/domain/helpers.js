import { CASE_TYPES, CHANNELS } from "./constants.js";
import { DomainError } from "./errors.js";

export function normalizeCaseInput(input) {
  return {
    type: input.type,
    channel: input.channel || CHANNELS.ONLINE,
    orderNumber: String(input.orderNumber || "").trim(),
    email: String(input.email || "").trim().toLowerCase(),
    phone: String(input.phone || "").trim(),
    description: String(input.description || "").trim(),
    reason: String(input.reason || "").trim(),
    attachments: Array.isArray(input.attachments)
      ? input.attachments.map((item) => String(item).trim()).filter(Boolean)
      : String(input.attachments || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
  };
}
export function validateCaseInput(input) {
  if (!Object.values(CASE_TYPES).includes(input.type)) {
    throw new DomainError("INVALID_TYPE", "Wybierz typ zgloszenia.");
  }
  if (!Object.values(CHANNELS).includes(input.channel)) {
    throw new DomainError("INVALID_CHANNEL", "Wybierz kanal zgloszenia.");
  }
  for (const field of ["orderNumber", "email", "description", "reason"]) {
    if (!input[field]) {
      throw new DomainError("REQUIRED_FIELD", `Pole ${field} jest obowiazkowe.`);
    }
  }
}
export function updateCase(state, caseId, updater) {
  let updatedCase = null;
  const cases = state.cases.map((item) => {
    if (item.id !== caseId) return item;
    updatedCase = updater(item);
    return stripPendingNotifications(updatedCase);
  });

  if (!updatedCase) {
    throw new DomainError("CASE_NOT_FOUND", "Nie znaleziono zgloszenia.");
  }

  return {
    state: {
      ...state,
      cases,
      notifications: [
        ...(updatedCase.pendingNotifications || []),
        ...state.notifications,
      ],
    },
    case: stripPendingNotifications(updatedCase),
  };
}
export function enqueueNotification(state, complaintCase, type, body, createdAt) {
  return {
    ...state,
    notifications: [
      notificationEntry(complaintCase, type, body, createdAt),
      ...state.notifications,
    ],
  };
}
export function enqueueNotificationForCase(complaintCase, type, body, createdAt) {
  return {
    ...complaintCase,
    pendingNotifications: [
      notificationEntry(complaintCase, type, body, createdAt),
      ...(complaintCase.pendingNotifications || []),
    ],
  };
}
export function stripPendingNotifications(complaintCase) {
  const { pendingNotifications, ...clean } = complaintCase;
  return clean;
}
export function historyEntry(status, actor, comment, createdAt) {
  return {
    id: makeId("hist"),
    status,
    actor: actor.name,
    role: actor.role,
    comment: String(comment || "").trim(),
    createdAt,
  };
}
export function notificationEntry(complaintCase, type, body, createdAt) {
  return {
    id: makeId("notif"),
    caseId: complaintCase.id,
    caseNumber: complaintCase.number,
    type,
    recipient: complaintCase.email,
    body,
    channel: "EMAIL/SMS",
    createdAt,
    deliveredWithinSeconds: 60,
  };
}
export function auditEntry(actor, action, details, createdAt) {
  return {
    id: makeId("audit"),
    actor,
    action,
    details,
    createdAt,
  };
}
export function makeCaseNumber(type, now, sequence) {
  const prefix = type === CASE_TYPES.RETURN ? "ZWR" : "REC";
  const year = new Date(now).getFullYear();
  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`;
}
export function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
export function toISODate(value) {
  return new Date(value).toISOString().slice(0, 10);
}
export function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}
export function diffDays(fromISO, toISO) {
  const from = new Date(`${fromISO}T00:00:00.000Z`);
  const to = new Date(`${toISO}T00:00:00.000Z`);
  return Math.round((to - from) / 86400000);
}
export function countBy(items, field) {
  return items.reduce((acc, item) => {
    const value = item[field] || "BRAK";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}
export function average(values) {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}
export function percent(value, total) {
  if (!total) return 0;
  return Number(((value / total) * 100).toFixed(1));
}
export function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
