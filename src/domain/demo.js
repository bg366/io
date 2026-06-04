import { auditEntry, toISODate } from "./helpers.js";
import { CASE_TYPES, CHANNELS, DEFAULT_CONFIG, ROLES, STATUSES } from "./constants.js";
import { createCase, generateReturnLabel, updateStatus } from "./cases.js";

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
