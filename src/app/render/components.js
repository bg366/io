import { STATUSES } from "../constants.js";
import { ui } from "../state.js";
import { escapeAttr, escapeHtml, labelFor } from "../utils.js";

export function renderOrderItem(order) {
  return `
    <article class="data-item">
      <div>
        <strong>${escapeHtml(order.number)}</strong>
        <span>${escapeHtml(order.customerName)}</span>
      </div>
      <p>${escapeHtml(order.product)} - ${escapeHtml(order.email)}</p>
    </article>
  `;
}
export function renderCaseListItem(item) {
  return `
    <button type="button" class="case-list-item ${item.id === ui.selectedCaseId ? "is-selected" : ""}" data-action="select-case" data-case-id="${escapeAttr(item.id)}">
      <span>
        <strong>${escapeHtml(item.number)}</strong>
        <small>${escapeHtml(item.customerName)} - ${escapeHtml(item.product)}</small>
      </span>
      ${statusChip(item.status)}
    </button>
  `;
}
export function renderEscalationItem(item) {
  const last = item.escalations[item.escalations.length - 1];
  return `
    <article class="data-item">
      <div>
        <strong>${escapeHtml(item.number)}</strong>
        ${statusChip(item.status)}
      </div>
      <p>${escapeHtml(last?.reason || "Eskalacja terminowa")}</p>
      <small>${escapeHtml(item.customerName)} - termin ${escapeHtml(item.deadlineAt)}</small>
    </article>
  `;
}
export function renderReport(report) {
  const topReasons = report.topReasons
    .map((item) => `<li><span>${escapeHtml(item.reason)}</span><strong>${item.count}</strong></li>`)
    .join("");

  return `
    <div class="metric-grid compact-top">
      ${metricCard("Lacznie", report.total)}
      ${metricCard("Akceptacje", `${report.acceptedPercent}%`)}
      ${metricCard("Odrzucenia", `${report.rejectedPercent}%`)}
      ${metricCard("Sredni czas", `${report.averageResolutionDays} dni`)}
    </div>
    <div class="report-grid">
      <section>
        <h3>Statusy</h3>
        ${renderCountList(report.byStatus)}
      </section>
      <section>
        <h3>Typy</h3>
        ${renderCountList(report.byType)}
      </section>
      <section>
        <h3>Najczestsze powody</h3>
        <ul class="count-list">${topReasons || "<li><span>Brak danych</span><strong>0</strong></li>"}</ul>
      </section>
    </div>
  `;
}
export function renderCountList(data) {
  const items = Object.entries(data)
    .map(([key, count]) => `<li><span>${escapeHtml(labelFor(key))}</span><strong>${count}</strong></li>`)
    .join("");
  return `<ul class="count-list">${items || "<li><span>Brak danych</span><strong>0</strong></li>"}</ul>`;
}
export function renderUserRow(user) {
  return `
    <tr>
      <td>
        <strong>${escapeHtml(user.name)}</strong>
        <small>${escapeHtml(user.email)}</small>
      </td>
      <td>${escapeHtml(labelFor(user.role))}</td>
      <td>${user.active ? "Aktywny" : "Nieaktywny"}</td>
      <td>
        <div class="table-actions">
          <button type="button" class="button subtle" data-action="edit-user" data-user-id="${escapeAttr(user.id)}">Edytuj</button>
          <button type="button" class="button subtle" data-action="toggle-user" data-user-id="${escapeAttr(user.id)}">${user.active ? "Dezaktywuj" : "Aktywuj"}</button>
        </div>
      </td>
    </tr>
  `;
}
export function renderHistoryItem(item) {
  return `
    <article class="timeline-item">
      <div>
        ${statusChip(item.status)}
        <small>${escapeHtml(item.createdAt)} - ${escapeHtml(item.actor)}</small>
      </div>
      <p>${escapeHtml(item.comment || "Bez komentarza")}</p>
    </article>
  `;
}
export function renderReturnLabel(label) {
  return `
    <section class="case-section inset">
      <h3>Etykieta zwrotna</h3>
      <dl class="facts-grid">
        ${fact("Kurier", label.courier)}
        ${fact("Tracking", label.trackingNumber)}
        ${fact("Format", label.format)}
        ${fact("Data", label.generatedAt)}
      </dl>
    </section>
  `;
}
export function renderDecision(decision) {
  return `
    <section class="case-section inset">
      <h3>Decyzja koncowa</h3>
      <dl class="facts-grid">
        ${fact("Typ", labelFor(decision.type))}
        ${fact("Autor", decision.author)}
        ${fact("Data", decision.createdAt)}
        ${fact("Finalna", decision.final ? "Tak" : "Nie")}
      </dl>
      ${decision.justification ? `<p>${escapeHtml(decision.justification)}</p>` : ""}
    </section>
  `;
}
export function metricCard(label, value) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </article>
  `;
}
export function statusChip(status = STATUSES.NEW) {
  return `<span class="status-chip status-${escapeAttr(String(status).toLowerCase())}">${escapeHtml(labelFor(status))}</span>`;
}
export function fact(label, value) {
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(String(value || "-"))}</dd>
    </div>
  `;
}
