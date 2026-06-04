import { CASE_TYPES, CHANNELS, DECISION_TYPES, ROLES, STATUSES } from "../constants.js";
import { escapeAttr, escapeHtml, labelFor } from "../utils.js";

export function fieldInput(name, label, value = "", required = false, type = "text") {
  const autocomplete = autocompleteFor(name, type);
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input type="${escapeAttr(type)}" name="${escapeAttr(name)}" value="${escapeAttr(value)}" ${autocomplete ? `autocomplete="${escapeAttr(autocomplete)}"` : ""} ${required ? "required" : ""} />
    </label>
  `;
}
export function autocompleteFor(name, type) {
  if (type === "password") return "current-password";
  if (type === "email") return "email";
  if (type === "tel") return "tel";
  if (name === "name") return "name";
  return "";
}
export function fieldSelect(name, label, options, selected = "", disabled = false) {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <select name="${escapeAttr(name)}" ${disabled ? "disabled" : ""}>
        ${options
          .map(
            (option) =>
              `<option value="${escapeAttr(option.value)}" ${option.value === selected ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
          )
          .join("")}
      </select>
    </label>
  `;
}
export function emptyStateMarkup(text) {
  return `<div class="empty-state"><p>${escapeHtml(text)}</p></div>`;
}
export function caseTypeOptions(withBlank = false) {
  return optionList(CASE_TYPES, withBlank);
}
export function channelOptions() {
  return optionList(CHANNELS, false);
}
export function statusOptions(withBlank = false) {
  return optionList(STATUSES, withBlank);
}
export function decisionOptions() {
  return optionList(DECISION_TYPES, false);
}
export function roleOptions() {
  return optionList(ROLES, false);
}
export function caseOptions(items) {
  return items.map((item) => ({
    value: item.id,
    label: `${item.number} - ${item.customerName}`,
  }));
}
export function optionList(source, withBlank) {
  const options = Object.values(source).map((value) => ({
    value,
    label: labelFor(value),
  }));
  return withBlank ? [{ value: "", label: "Wszystkie" }, ...options] : options;
}
