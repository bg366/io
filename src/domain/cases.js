import { CASE_TYPES, DECISION_TYPES, FINAL_STATUSES, ROLES, STATUSES } from "./constants.js";
import { DomainError } from "./errors.js";
import {
  addDays,
  diffDays,
  enqueueNotification,
  enqueueNotificationForCase,
  historyEntry,
  makeCaseNumber,
  makeId,
  normalizeCaseInput,
  toISODate,
  updateCase,
  validateCaseInput,
} from "./helpers.js";

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
