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
