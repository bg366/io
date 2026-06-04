export const TOKEN_KEY = "szrz-poc-api-token-v1";

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

export const demoAccounts = [
  {
    label: "Klient",
    email: "client@example.com",
    password: "demo123",
  },
  {
    label: "Pracownik",
    email: "marta.ops@example.com",
    password: "demo123",
  },
  {
    label: "Kierownik",
    email: "tomasz.manager@example.com",
    password: "demo123",
  },
  {
    label: "Admin",
    email: "ewa.admin@example.com",
    password: "demo123",
  },
];

export const labels = {
  [CASE_TYPES.COMPLAINT]: "Reklamacja",
  [CASE_TYPES.RETURN]: "Zwrot",
  [CHANNELS.ONLINE]: "Online",
  [CHANNELS.EMAIL]: "E-mail",
  [CHANNELS.PHONE]: "Telefon",
  [CHANNELS.IN_PERSON]: "Osobiscie",
  [STATUSES.NEW]: "Nowe",
  [STATUSES.IN_PROGRESS]: "W trakcie",
  [STATUSES.WAITING_FOR_GOODS]: "Oczekuje na towar",
  [STATUSES.DECIDED]: "Rozpatrzone",
  [STATUSES.CLOSED]: "Zamkniete",
  [STATUSES.ESCALATED]: "Eskalowane",
  [DECISION_TYPES.REPAIR]: "Naprawa",
  [DECISION_TYPES.REPLACE]: "Wymiana",
  [DECISION_TYPES.REFUND]: "Zwrot gotowki",
  [DECISION_TYPES.PRICE_REDUCTION]: "Obnizenie ceny",
  [DECISION_TYPES.REJECT]: "Odrzucenie",
  [ROLES.CLIENT]: "Klient",
  [ROLES.EMPLOYEE]: "Pracownik obslugi",
  [ROLES.MANAGER]: "Kierownik",
  [ROLES.ADMIN]: "Administrator",
};
