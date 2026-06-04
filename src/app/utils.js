import { labels } from "./constants.js";

export function cleanedFilters(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
}
export function queryString(params) {
  return new URLSearchParams(cleanedFilters(params)).toString();
}
export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}
export function errorMessage(error) {
  return error?.message || "Operacja nie powiodla sie.";
}
export function labelFor(value) {
  return labels[value] || value;
}
export function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return 0;
  const from = new Date(`${fromISO}T00:00:00.000Z`);
  const to = new Date(`${toISO}T00:00:00.000Z`);
  return Math.round((to - from) / 86400000);
}
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
export function escapeAttr(value) {
  return escapeHtml(value);
}
