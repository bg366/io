export const CASE_TYPES = Object.freeze({
  COMPLAINT: "REKLAMACJA",
  RETURN: "ZWROT",
});

export const CHANNELS = Object.freeze({
  ONLINE: "ONLINE",
  EMAIL: "EMAIL",
  PHONE: "TELEFON",
  IN_PERSON: "OSOBISCIE",
});

export const STATUSES = Object.freeze({
  NEW: "NOWE",
  IN_PROGRESS: "W_TRAKCIE",
  WAITING_FOR_GOODS: "OCZEKUJE_NA_TOWAR",
  DECIDED: "ROZPATRZONE",
  CLOSED: "ZAMKNIETE",
  ESCALATED: "ESKALOWANE",
});

export const DECISION_TYPES = Object.freeze({
  REPAIR: "NAPRAWA",
  REPLACE: "WYMIANA",
  REFUND: "ZWROT_GOTOWKI",
  PRICE_REDUCTION: "OBNIZENIE_CENY",
  REJECT: "ODRZUCENIE",
});

export const ROLES = Object.freeze({
  CLIENT: "KLIENT",
  EMPLOYEE: "PRACOWNIK_OBSLUGI",
  MANAGER: "KIEROWNIK",
  ADMIN: "ADMINISTRATOR",
});

export const DEFAULT_CONFIG = Object.freeze({
  complaintDeadlineDays: 30,
  returnDeadlineDays: 14,
  alertThresholdDays: 2,
  staleEscalationDays: 5,
});

export const FINAL_STATUSES = new Set([STATUSES.DECIDED, STATUSES.CLOSED]);

export function createDemoState(now = new Date()) {
  const createdAt = toISODate(now);
  const state = {
    config: { ...DEFAULT_CONFIG },
    orders: [
      {
        number: "ORD-2026-1001",
        customerName: "Jan Kowalski",
        email: "jan.kowalski@example.com",
        phone: "+48123123123",
        product: "Laptop Orion 14",
        category: "Laptopy",
        purchasedAt: "2026-05-12",
      },
      {
        number: "ORD-2026-1002",
        customerName: "Anna Nowak",
        email: "anna.nowak@example.com",
        phone: "+48500500500",
        product: "Smartfon PixelLine X",
        category: "Telefony",
        purchasedAt: "2026-05-18",
      },
      {
        number: "ORD-2026-1003",
        customerName: "Piotr Zielinski",
        email: "piotr.zielinski@example.com",
        phone: "+48600600600",
        product: "Monitor ViewPro 27",
        category: "Monitory",
        purchasedAt: "2026-04-26",
      },
    ],
    cases: [],
    notifications: [],
    auditLog: [
      auditEntry("SYSTEM", "INIT", "Uruchomiono dane demonstracyjne", createdAt),
    ],
    users: [
      {
        id: "usr-employee",
        name: "Marta Lewandowska",
        email: "marta.ops@example.com",
        role: ROLES.EMPLOYEE,
        active: true,
      },
      {
        id: "usr-manager",
        name: "Tomasz Krol",
        email: "tomasz.manager@example.com",
        role: ROLES.MANAGER,
        active: true,
      },
      {
        id: "usr-admin",
        name: "Ewa Admin",
        email: "ewa.admin@example.com",
        role: ROLES.ADMIN,
        active: true,
      },
    ],
  };

  let next = createCase(
    state,
    {
      type: CASE_TYPES.COMPLAINT,
      channel: CHANNELS.ONLINE,
      orderNumber: "ORD-2026-1001",
      email: "jan.kowalski@example.com",
      phone: "+48123123123",
      description: "Laptop uruchamia sie tylko po kilku probach.",
      reason: "Awaria sprzetu",
      attachments: ["diagnostyka.jpg"],
    },
    { id: "client-jan", name: "Jan Kowalski", role: ROLES.CLIENT },
    now,
  ).state;

  next = updateStatus(
    next,
    next.cases[0].id,
    STATUSES.IN_PROGRESS,
    { id: "usr-employee", name: "Marta Lewandowska", role: ROLES.EMPLOYEE },
    "Zweryfikowano zamowienie w mock ERP.",
    now,
  ).state;

  next = createCase(
    next,
    {
      type: CASE_TYPES.RETURN,
      channel: CHANNELS.PHONE,
      orderNumber: "ORD-2026-1002",
      email: "anna.nowak@example.com",
      phone: "+48500500500",
      description: "Klientka chce zwrocic telefon w terminie ustawowym.",
      reason: "Zwrot konsumencki",
      attachments: [],
    },
    { id: "usr-employee", name: "Marta Lewandowska", role: ROLES.EMPLOYEE },
    now,
  ).state;

  next = generateReturnLabel(
    next,
    next.cases[0].id,
    "InPost",
    { id: "usr-employee", name: "Marta Lewandowska", role: ROLES.EMPLOYEE },
    now,
  ).state;

  return next;
}

export function createCase(state, input, actor, now = new Date()) {
  const data = normalizeCaseInput(input);
  validateCaseInput(data);

  const order = verifyOrder(state.orders, data.orderNumber, data.email);
  if (!order) {
    throw new DomainError(
      "ORDER_NOT_FOUND",
      "Nie znaleziono zamowienia dla podanego numeru i e-maila.",
    );
  }

  if (data.attachments.length > 5) {
    throw new DomainError("TOO_MANY_ATTACHMENTS", "Mozna dodac maksymalnie 5 zalacznikow.");
  }

  const createdAt = toISODate(now);
  const caseNumber = makeCaseNumber(data.type, now, state.cases.length + 1);
  const deadlineAt = addDays(
    createdAt,
    data.type === CASE_TYPES.RETURN
      ? state.config.returnDeadlineDays
      : state.config.complaintDeadlineDays,
  );

  const complaintCase = {
    id: makeId("case"),
    number: caseNumber,
    type: data.type,
    channel: data.channel,
    status: STATUSES.NEW,
    priority: "NORMALNY",
    orderNumber: data.orderNumber,
    customerName: order.customerName,
    email: data.email,
    phone: data.phone || order.phone,
    product: order.product,
    category: order.category,
    description: data.description,
    reason: data.reason,
    attachments: data.attachments,
    createdAt,
    deadlineAt,
    assignedTo: actor.role === ROLES.EMPLOYEE ? actor.name : null,
    decision: null,
    returnLabel: null,
    history: [
      historyEntry(STATUSES.NEW, actor, "Zgloszenie zarejestrowane.", createdAt),
    ],
    escalations: [],
  };

  const next = {
    ...state,
    cases: [complaintCase, ...state.cases],
  };

  return {
    state: enqueueNotification(
      next,
      complaintCase,
      "POTWIERDZENIE",
      `Zarejestrowano zgloszenie ${complaintCase.number}.`,
      createdAt,
    ),
    case: complaintCase,
  };
}

export function verifyOrder(orders, orderNumber, email) {
  const normalizedNumber = String(orderNumber || "").trim().toUpperCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return orders.find(
    (order) =>
      order.number.toUpperCase() === normalizedNumber &&
      (!normalizedEmail || order.email.toLowerCase() === normalizedEmail),
  );
}

export function lookupCase(state, number, email) {
  const normalizedNumber = String(number || "").trim().toUpperCase();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return (
    state.cases.find(
      (item) =>
        item.number.toUpperCase() === normalizedNumber &&
        item.email.toLowerCase() === normalizedEmail,
    ) || null
  );
}

export function updateStatus(state, caseId, status, actor, comment = "", now = new Date()) {
  if (!Object.values(STATUSES).includes(status)) {
    throw new DomainError("INVALID_STATUS", "Nieznany status zgloszenia.");
  }

  const changedAt = toISODate(now);
  return updateCase(state, caseId, (item) => {
    if (FINAL_STATUSES.has(item.status) && status !== STATUSES.CLOSED) {
      throw new DomainError("CASE_FINAL", "Sprawa jest juz rozpatrzona.");
    }
    const updated = {
      ...item,
      status,
      history: [...item.history, historyEntry(status, actor, comment, changedAt)],
    };
    return enqueueNotificationForCase(
      updated,
      "STATUS",
      `Status zgloszenia ${updated.number}: ${status}.`,
      changedAt,
    );
  });
}

export function createDecision(state, caseId, input, actor, now = new Date()) {
  const decidedAt = toISODate(now);
  const type = input.type;
  if (!Object.values(DECISION_TYPES).includes(type)) {
    throw new DomainError("INVALID_DECISION", "Nieznany typ decyzji.");
  }
  if (type === DECISION_TYPES.REJECT && !String(input.justification || "").trim()) {
    throw new DomainError("JUSTIFICATION_REQUIRED", "Uzasadnienie odmowy jest obowiazkowe.");
  }

  return updateCase(state, caseId, (item) => {
    if (item.decision) {
      throw new DomainError("DECISION_IMMUTABLE", "Zatwierdzonej decyzji nie mozna zmienic.");
    }

    const decision = Object.freeze({
      id: makeId("decision"),
      type,
      justification: String(input.justification || "").trim(),
      author: actor.name,
      createdAt: decidedAt,
      final: Boolean(input.final ?? true),
    });

    const updated = {
      ...item,
      status: STATUSES.DECIDED,
      decision,
      history: [
        ...item.history,
        historyEntry(
          STATUSES.DECIDED,
          actor,
          `Decyzja: ${type}${decision.justification ? ` - ${decision.justification}` : ""}`,
          decidedAt,
        ),
      ],
    };

    return enqueueNotificationForCase(
      updated,
      "DECYZJA",
      `Wydano decyzje dla zgloszenia ${updated.number}: ${type}.`,
      decidedAt,
    );
  });
}

export function escalateCase(state, caseId, reason, actor, now = new Date()) {
  const escalatedAt = toISODate(now);
  return updateCase(state, caseId, (item) => {
    if (FINAL_STATUSES.has(item.status)) {
      throw new DomainError("CASE_FINAL", "Nie mozna eskalowac zamknietej sprawy.");
    }

    const updated = {
      ...item,
      status: STATUSES.ESCALATED,
      priority: "PILNY",
      escalations: [
        ...item.escalations,
        {
          id: makeId("esc"),
          reason: String(reason || "Eskalacja bez komentarza").trim(),
          author: actor.name,
          createdAt: escalatedAt,
        },
      ],
      history: [
        ...item.history,
        historyEntry(STATUSES.ESCALATED, actor, reason, escalatedAt),
      ],
    };

    return enqueueNotificationForCase(
      updated,
      "ESKALACJA",
      `Zgloszenie ${updated.number} zostalo eskalowane do kierownika.`,
      escalatedAt,
    );
  });
}

export function generateReturnLabel(state, caseId, courier, actor, now = new Date()) {
  const generatedAt = toISODate(now);
  return updateCase(state, caseId, (item) => {
    const label = {
      id: makeId("label"),
      courier,
      trackingNumber: `TRK-${String(Math.floor(Math.random() * 1000000)).padStart(6, "0")}`,
      format: "PDF",
      generatedAt,
    };

    const updated = {
      ...item,
      status: STATUSES.WAITING_FOR_GOODS,
      returnLabel: label,
      history: [
        ...item.history,
        historyEntry(
          STATUSES.WAITING_FOR_GOODS,
          actor,
          `Wygenerowano etykiete zwrotna ${courier}.`,
          generatedAt,
        ),
      ],
    };

    return enqueueNotificationForCase(
      updated,
      "ETYKIETA",
      `Wyslano etykiete zwrotna ${courier} dla ${updated.number}.`,
      generatedAt,
    );
  });
}

export function confirmWmsReceipt(state, caseId, condition, now = new Date()) {
  const receivedAt = toISODate(now);
  return updateCase(state, caseId, (item) => {
    const updated = {
      ...item,
      status: STATUSES.IN_PROGRESS,
      history: [
        ...item.history,
        historyEntry(
          STATUSES.IN_PROGRESS,
          { id: "wms", name: "Mock WMS", role: "SYSTEM" },
          `Magazyn potwierdzil odbior towaru. Stan: ${condition}.`,
          receivedAt,
        ),
      ],
    };

    return enqueueNotificationForCase(
      updated,
      "WMS",
      `Mock WMS potwierdzil odbior towaru dla ${updated.number}.`,
      receivedAt,
    );
  });
}

export function evaluateDeadlines(state, now = new Date()) {
  const today = toISODate(now);
  const systemActor = { id: "system", name: "System SZRZ", role: "SYSTEM" };
  let next = state;

  for (const item of state.cases) {
    const current = next.cases.find((candidate) => candidate.id === item.id);
    if (!current || FINAL_STATUSES.has(current.status)) {
      continue;
    }

    const daysLeft = diffDays(today, current.deadlineAt);
    const lastChange = current.history[current.history.length - 1]?.createdAt || current.createdAt;
    const staleDays = diffDays(lastChange, today);

    if (daysLeft < 0) {
      next = escalateCase(
        next,
        current.id,
        "Przekroczono termin ustawowy.",
        systemActor,
        now,
      ).state;
      continue;
    }

    if (
      daysLeft <= next.config.alertThresholdDays &&
      !current.history.some((entry) => entry.comment.includes("Alert terminu"))
    ) {
      next = updateCase(next, current.id, (caseItem) => {
        const updated = {
          ...caseItem,
          history: [
            ...caseItem.history,
            historyEntry(caseItem.status, systemActor, `Alert terminu: ${daysLeft} dni.`, today),
          ],
        };
        return enqueueNotificationForCase(
          updated,
          "ALERT",
          `Termin dla ${updated.number}: ${daysLeft} dni.`,
          today,
        );
      }).state;
    }

    if (staleDays > next.config.staleEscalationDays && current.status !== STATUSES.ESCALATED) {
      next = escalateCase(
        next,
        current.id,
        `Brak zmiany statusu przez ${staleDays} dni.`,
        systemActor,
        now,
      ).state;
    }
  }

  return { state: next };
}

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

export class DomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DomainError";
    this.code = code;
  }
}

function normalizeCaseInput(input) {
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

function validateCaseInput(input) {
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

function updateCase(state, caseId, updater) {
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

function enqueueNotification(state, complaintCase, type, body, createdAt) {
  return {
    ...state,
    notifications: [
      notificationEntry(complaintCase, type, body, createdAt),
      ...state.notifications,
    ],
  };
}

function enqueueNotificationForCase(complaintCase, type, body, createdAt) {
  return {
    ...complaintCase,
    pendingNotifications: [
      notificationEntry(complaintCase, type, body, createdAt),
      ...(complaintCase.pendingNotifications || []),
    ],
  };
}

function stripPendingNotifications(complaintCase) {
  const { pendingNotifications, ...clean } = complaintCase;
  return clean;
}

function historyEntry(status, actor, comment, createdAt) {
  return {
    id: makeId("hist"),
    status,
    actor: actor.name,
    role: actor.role,
    comment: String(comment || "").trim(),
    createdAt,
  };
}

function notificationEntry(complaintCase, type, body, createdAt) {
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

function auditEntry(actor, action, details, createdAt) {
  return {
    id: makeId("audit"),
    actor,
    action,
    details,
    createdAt,
  };
}

function makeCaseNumber(type, now, sequence) {
  const prefix = type === CASE_TYPES.RETURN ? "ZWR" : "REC";
  const year = new Date(now).getFullYear();
  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`;
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toISODate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

function diffDays(fromISO, toISO) {
  const from = new Date(`${fromISO}T00:00:00.000Z`);
  const to = new Date(`${toISO}T00:00:00.000Z`);
  return Math.round((to - from) / 86400000);
}

function countBy(items, field) {
  return items.reduce((acc, item) => {
    const value = item[field] || "BRAK";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function average(values) {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function percent(value, total) {
  if (!total) return 0;
  return Number(((value / total) * 100).toFixed(1));
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
