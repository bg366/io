import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CASE_TYPES,
  CHANNELS,
  DECISION_TYPES,
  DEFAULT_CONFIG,
  DomainError,
  ROLES,
  STATUSES,
  confirmWmsReceipt,
  createCase,
  createDecision,
  evaluateDeadlines,
  generateReport,
  generateReturnLabel,
  updateConfiguration,
  updateStatus,
} from "../src/domain.js";

const customer = { id: "client-1", name: "Jan Kowalski", role: ROLES.CLIENT };
const employee = { id: "usr-employee", name: "Marta Lewandowska", role: ROLES.EMPLOYEE };
const manager = { id: "usr-manager", name: "Tomasz Krol", role: ROLES.MANAGER };
const admin = { id: "usr-admin", name: "Ewa Admin", role: ROLES.ADMIN };

function makeState(config = {}) {
  return {
    config: { ...DEFAULT_CONFIG, ...config },
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
    auditLog: [],
    users: [],
  };
}

function caseInput(overrides = {}) {
  return {
    type: CASE_TYPES.COMPLAINT,
    channel: CHANNELS.ONLINE,
    orderNumber: "ORD-2026-1001",
    email: "jan.kowalski@example.com",
    phone: "+48123123123",
    description: "Produkt nie dziala prawidlowo.",
    reason: "Awaria sprzetu",
    attachments: ["photo.png"],
    ...overrides,
  };
}

function assertDomainError(fn, code) {
  assert.throws(fn, (error) => error instanceof DomainError && error.code === code);
}

function findCase(state, caseId) {
  return state.cases.find((item) => item.id === caseId);
}

test("ERP validation blocks case creation for an unknown order", () => {
  assertDomainError(
    () =>
      createCase(
        makeState(),
        caseInput({ orderNumber: "ORD-404", email: "jan.kowalski@example.com" }),
        customer,
        new Date("2026-06-01T10:00:00.000Z"),
      ),
    "ORDER_NOT_FOUND",
  );
});

test("case numbers are unique and deadlines follow case type configuration", () => {
  let state = makeState();
  const now = new Date("2026-06-01T10:00:00.000Z");

  const complaint = createCase(state, caseInput(), customer, now);
  state = complaint.state;
  const returnCase = createCase(
    state,
    caseInput({
      type: CASE_TYPES.RETURN,
      orderNumber: "ORD-2026-1002",
      email: "anna.nowak@example.com",
      phone: "+48500500500",
      reason: "Zwrot konsumencki",
    }),
    employee,
    now,
  );

  assert.equal(complaint.case.number, "REC-2026-00001");
  assert.equal(returnCase.case.number, "ZWR-2026-00002");
  assert.notEqual(complaint.case.number, returnCase.case.number);
  assert.equal(complaint.case.deadlineAt, "2026-07-01");
  assert.equal(returnCase.case.deadlineAt, "2026-06-15");
});

test("status changes append history and enqueue a notification", () => {
  const created = createCase(
    makeState(),
    caseInput(),
    customer,
    new Date("2026-06-01T10:00:00.000Z"),
  );

  const changed = updateStatus(
    created.state,
    created.case.id,
    STATUSES.IN_PROGRESS,
    employee,
    "Zweryfikowano zamowienie w mock ERP.",
    new Date("2026-06-02T09:00:00.000Z"),
  );
  const complaint = findCase(changed.state, created.case.id);
  const lastHistory = complaint.history.at(-1);

  assert.equal(complaint.status, STATUSES.IN_PROGRESS);
  assert.equal(complaint.history.length, 2);
  assert.equal(lastHistory.status, STATUSES.IN_PROGRESS);
  assert.equal(lastHistory.actor, employee.name);
  assert.equal(lastHistory.comment, "Zweryfikowano zamowienie w mock ERP.");
  assert.equal(changed.state.notifications[0].type, "STATUS");
  assert.equal(changed.state.notifications[0].caseNumber, complaint.number);
});

test("rejected decisions require justification", () => {
  const created = createCase(
    makeState(),
    caseInput(),
    customer,
    new Date("2026-06-01T10:00:00.000Z"),
  );

  assertDomainError(
    () =>
      createDecision(
        created.state,
        created.case.id,
        { type: DECISION_TYPES.REJECT, justification: "   " },
        employee,
        new Date("2026-06-03T12:00:00.000Z"),
      ),
    "JUSTIFICATION_REQUIRED",
  );
});

test("approved decisions are immutable", () => {
  const created = createCase(
    makeState(),
    caseInput(),
    customer,
    new Date("2026-06-01T10:00:00.000Z"),
  );

  const decided = createDecision(
    created.state,
    created.case.id,
    { type: DECISION_TYPES.REFUND, justification: "Zwrot zasadny." },
    employee,
    new Date("2026-06-04T12:00:00.000Z"),
  );
  const complaint = findCase(decided.state, created.case.id);

  assert.equal(complaint.status, STATUSES.DECIDED);
  assert.equal(complaint.decision.type, DECISION_TYPES.REFUND);
  assert.equal(complaint.decision.justification, "Zwrot zasadny.");
  assert.equal(Object.isFrozen(complaint.decision), true);
  assertDomainError(
    () =>
      createDecision(
        decided.state,
        created.case.id,
        { type: DECISION_TYPES.REPAIR, justification: "Zmiana decyzji." },
        manager,
        new Date("2026-06-05T12:00:00.000Z"),
      ),
    "DECISION_IMMUTABLE",
  );
});

test("return label starts physical return flow and WMS receipt resumes handling", () => {
  const created = createCase(
    makeState(),
    caseInput({
      type: CASE_TYPES.RETURN,
      orderNumber: "ORD-2026-1002",
      email: "anna.nowak@example.com",
      phone: "+48500500500",
      reason: "Zwrot konsumencki",
    }),
    employee,
    new Date("2026-06-01T10:00:00.000Z"),
  );

  const labeled = generateReturnLabel(
    created.state,
    created.case.id,
    "InPost",
    employee,
    new Date("2026-06-02T10:00:00.000Z"),
  );
  const waiting = findCase(labeled.state, created.case.id);

  assert.equal(waiting.status, STATUSES.WAITING_FOR_GOODS);
  assert.equal(waiting.returnLabel.courier, "InPost");
  assert.match(waiting.returnLabel.trackingNumber, /^TRK-\d{6}$/);
  assert.equal(labeled.state.notifications[0].type, "ETYKIETA");

  const received = confirmWmsReceipt(
    labeled.state,
    created.case.id,
    "bez uszkodzen",
    new Date("2026-06-03T10:00:00.000Z"),
  );
  const resumed = findCase(received.state, created.case.id);
  const lastHistory = resumed.history.at(-1);

  assert.equal(resumed.status, STATUSES.IN_PROGRESS);
  assert.equal(lastHistory.actor, "Mock WMS");
  assert.match(lastHistory.comment, /bez uszkodzen/);
  assert.equal(received.state.notifications[0].type, "WMS");
});

test("deadline evaluation creates alerts and escalates stale cases", () => {
  const alertCase = createCase(
    makeState({ staleEscalationDays: 99 }),
    caseInput(),
    customer,
    new Date("2026-06-01T10:00:00.000Z"),
  );
  const alerted = evaluateDeadlines(alertCase.state, new Date("2026-06-30T10:00:00.000Z"));
  const nearDeadline = findCase(alerted.state, alertCase.case.id);

  assert.equal(nearDeadline.status, STATUSES.NEW);
  assert.equal(nearDeadline.history.at(-1).comment, "Alert terminu: 1 dni.");
  assert.equal(alerted.state.notifications[0].type, "ALERT");

  const staleCase = createCase(
    makeState(),
    caseInput({
      orderNumber: "ORD-2026-1003",
      email: "piotr.zielinski@example.com",
      phone: "+48600600600",
    }),
    customer,
    new Date("2026-06-01T10:00:00.000Z"),
  );
  const escalated = evaluateDeadlines(staleCase.state, new Date("2026-06-07T10:00:00.000Z"));
  const stale = findCase(escalated.state, staleCase.case.id);

  assert.equal(stale.status, STATUSES.ESCALATED);
  assert.equal(stale.priority, "PILNY");
  assert.equal(stale.escalations[0].reason, "Brak zmiany statusu przez 6 dni.");
  assert.equal(escalated.state.notifications[0].type, "ESKALACJA");
});

test("reports aggregate statuses, types, decisions, durations, and reasons", () => {
  let state = makeState();

  const complaint = createCase(
    state,
    caseInput({ reason: "Awaria sprzetu" }),
    customer,
    new Date("2026-06-01T10:00:00.000Z"),
  );
  state = complaint.state;
  state = createDecision(
    state,
    complaint.case.id,
    { type: DECISION_TYPES.REPAIR, justification: "Naprawa gwarancyjna." },
    employee,
    new Date("2026-06-06T10:00:00.000Z"),
  ).state;

  const rejectedReturn = createCase(
    state,
    caseInput({
      type: CASE_TYPES.RETURN,
      orderNumber: "ORD-2026-1002",
      email: "anna.nowak@example.com",
      phone: "+48500500500",
      reason: "Zwrot konsumencki",
    }),
    employee,
    new Date("2026-06-01T10:00:00.000Z"),
  );
  state = rejectedReturn.state;
  state = createDecision(
    state,
    rejectedReturn.case.id,
    { type: DECISION_TYPES.REJECT, justification: "Towar uszkodzony mechanicznie." },
    employee,
    new Date("2026-06-03T10:00:00.000Z"),
  ).state;

  state = createCase(
    state,
    caseInput({
      orderNumber: "ORD-2026-1003",
      email: "piotr.zielinski@example.com",
      phone: "+48600600600",
      reason: "Awaria sprzetu",
    }),
    customer,
    new Date("2026-06-02T10:00:00.000Z"),
  ).state;

  const report = generateReport(state);

  assert.equal(report.total, 3);
  assert.equal(report.acceptedPercent, 50);
  assert.equal(report.rejectedPercent, 50);
  assert.equal(report.averageResolutionDays, 3.5);
  assert.deepEqual(report.topReasons[0], { reason: "Awaria sprzetu", count: 2 });
  assert.equal(report.byStatus[STATUSES.DECIDED], 2);
  assert.equal(report.byStatus[STATUSES.NEW], 1);
  assert.equal(report.byType[CASE_TYPES.COMPLAINT], 2);
  assert.equal(report.byType[CASE_TYPES.RETURN], 1);
});

test("admin configuration changes are persisted and audited", () => {
  const updated = updateConfiguration(
    makeState(),
    {
      complaintDeadlineDays: 21,
      returnDeadlineDays: 10,
      alertThresholdDays: 1,
      staleEscalationDays: 3,
    },
    admin,
    new Date("2026-06-04T08:00:00.000Z"),
  );
  const auditEntry = updated.state.auditLog[0];

  assert.equal(updated.state.config.complaintDeadlineDays, 21);
  assert.equal(updated.state.config.returnDeadlineDays, 10);
  assert.equal(updated.state.config.alertThresholdDays, 1);
  assert.equal(updated.state.config.staleEscalationDays, 3);
  assert.equal(auditEntry.actor, admin.name);
  assert.equal(auditEntry.action, "CONFIG_UPDATE");
  assert.match(auditEntry.details, /reklamacja 30->21/);
  assert.match(auditEntry.details, /zwrot 14->10/);
  assert.match(auditEntry.details, /alert 2->1/);
});
