import { FINAL_STATUSES, STATUSES } from "../constants.js";
import { auditCount, auditLog, message, notificationCount, notificationList, systemSummary, tabs } from "../dom.js";
import { state, ui } from "../state.js";
import { escapeHtml } from "../utils.js";
import { emptyStateMarkup } from "./forms.js";

export function renderOperations() {
  notificationCount.textContent = String(state.notifications.length);
  auditCount.textContent = String(state.auditLog.length);
  notificationList.innerHTML =
    state.notifications
      .slice(0, 8)
      .map(
        (item) => `
          <article class="log-item">
            <div>
              <strong>${escapeHtml(item.type)}</strong>
              <span>${escapeHtml(item.caseNumber)}</span>
            </div>
            <p>${escapeHtml(item.body)}</p>
            <small>${escapeHtml(item.recipient)} - ${escapeHtml(item.createdAt)}</small>
          </article>
        `,
      )
      .join("") || emptyStateMarkup("Brak powiadomien.");

  auditLog.innerHTML =
    state.auditLog
      .slice(0, 8)
      .map(
        (item) => `
          <article class="log-item">
            <div>
              <strong>${escapeHtml(item.action)}</strong>
              <span>${escapeHtml(item.actor)}</span>
            </div>
            <p>${escapeHtml(item.details)}</p>
            <small>${escapeHtml(item.createdAt)}</small>
          </article>
        `,
      )
      .join("") || emptyStateMarkup("Brak wpisow audytu.");
}
export function renderSystemSummary() {
  const active = state.cases.filter((item) => !FINAL_STATUSES.has(item.status)).length;
  const escalated = state.cases.filter((item) => item.status === STATUSES.ESCALATED).length;
  systemSummary.innerHTML = `
    <span>${state.cases.length} spraw</span>
    <span>${active} aktywne</span>
    <span>${escalated} eskalowane</span>
  `;
}
export function renderTabs() {
  for (const button of tabs.querySelectorAll("[data-tab]")) {
    const selected = button.dataset.tab === ui.activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  }
}
export function renderMessage() {
  if (!ui.message) {
    message.hidden = true;
    message.textContent = "";
    message.className = "message";
    return;
  }
  message.hidden = false;
  message.textContent = ui.message.text;
  message.className = `message ${ui.message.type}`;
}
