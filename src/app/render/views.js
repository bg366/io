import { CASE_TYPES, CHANNELS, DECISION_TYPES, FINAL_STATUSES, ROLES, STATUSES, demoAccounts } from "../constants.js";
import { sessionPanel } from "../dom.js";
import { emptyReport } from "../normalizers.js";
import { session, state, todayISO, ui } from "../state.js";
import { daysBetween, escapeAttr, escapeHtml, labelFor } from "../utils.js";
import {
  caseOptions,
  caseTypeOptions,
  channelOptions,
  decisionOptions,
  emptyStateMarkup,
  fieldInput,
  fieldSelect,
  roleOptions,
  statusOptions,
} from "./forms.js";
import {
  fact,
  metricCard,
  renderCaseListItem,
  renderCountList,
  renderDecision,
  renderEscalationItem,
  renderHistoryItem,
  renderOrderItem,
  renderReport,
  renderReturnLabel,
  renderUserRow,
  statusChip,
} from "./components.js";
import { filteredCases, selectedCase } from "./selectors.js";

export function renderSessionPanel() {
  if (!sessionPanel) return;

  if (session.user) {
    sessionPanel.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Sesja API</p>
          <h2>${escapeHtml(session.user.name || session.user.email)}</h2>
        </div>
        <span class="counter">${escapeHtml(labelFor(session.user.role || ""))}</span>
      </div>
      <div class="compact-form">
        <span class="muted">${escapeHtml(session.user.email || "")}</span>
        <button type="button" class="button subtle" data-action="logout">Wyloguj</button>
      </div>
    `;
    return;
  }

  sessionPanel.innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Sesja API</p>
        <h2>Logowanie demo</h2>
      </div>
    </div>
    <form id="login-form" class="compact-form">
      ${fieldInput("email", "E-mail", "marta.ops@example.com", true, "email")}
      ${fieldInput("password", "Haslo", "demo123", true, "password")}
      <button type="submit" class="button primary">Zaloguj</button>
    </form>
    <div class="compact-form compact-top">
      ${demoAccounts
        .map(
          (account) => `
            <button
              type="button"
              class="button subtle"
              data-action="demo-login"
              data-email="${escapeAttr(account.email)}"
              data-password="${escapeAttr(account.password)}"
            >
              ${escapeHtml(account.label)}
            </button>
          `,
        )
        .join("")}
    </div>
  `;
}
export function renderClientView() {
  return `
    <section class="view-grid view-grid-balanced">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Portal klienta</p>
            <h2>Nowe zgloszenie</h2>
          </div>
        </div>
        <form id="client-form" class="form-grid">
          ${fieldSelect("type", "Typ", caseTypeOptions(), CASE_TYPES.COMPLAINT)}
          ${fieldSelect("channel", "Kanal", channelOptions(), CHANNELS.ONLINE)}
          ${fieldInput("orderNumber", "Numer zamowienia", "ORD-2026-1001", true)}
          ${fieldInput("email", "E-mail", "jan.kowalski@example.com", true, "email")}
          ${fieldInput("phone", "Telefon", "+48123123123", false, "tel")}
          ${fieldInput("reason", "Powod", "Awaria sprzetu", true)}
          <label class="field field-full">
            <span>Opis</span>
            <textarea name="description" rows="5" required placeholder="Opis problemu lub powodu zwrotu"></textarea>
          </label>
          ${fieldInput("attachments", "Zalaczniki", "zdjecie.jpg, protokol.png")}
          <div class="form-actions field-full">
            <button type="submit" class="button primary">Zarejestruj</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Mock ERP</p>
            <h2>Zamowienia testowe</h2>
          </div>
        </div>
        <div class="data-list">
          ${state.orders.map(renderOrderItem).join("") || emptyStateMarkup("Brak zamowien z API.")}
        </div>
      </section>
    </section>
  `;
}
export function renderStatusView() {
  return `
    <section class="view-grid view-grid-balanced">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Publiczny podglad</p>
            <h2>Status sprawy</h2>
          </div>
        </div>
        <form id="lookup-form" class="form-grid">
          ${fieldInput("number", "Numer sprawy", ui.lookup?.number || "REC-2026-00001", true)}
          ${fieldInput("email", "E-mail", ui.lookup?.email || "jan.kowalski@example.com", true, "email")}
          <div class="form-actions field-full">
            <button type="submit" class="button primary">Sprawdz status</button>
          </div>
        </form>
      </section>
      <section class="panel">
        ${renderLookupResult()}
      </section>
    </section>
  `;
}
export function renderEmployeeView() {
  const cases = filteredCases();
  const selected = selectedCase();

  return `
    <section class="employee-layout">
      <aside class="panel case-browser">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Pracownik</p>
            <h2>Kolejka spraw</h2>
          </div>
          <span class="counter">${cases.length}</span>
        </div>
        <form id="employee-filters" class="compact-form">
          ${fieldInput("query", "Szukaj", ui.employeeFilters.query, false)}
          ${fieldSelect("status", "Status", statusOptions(true), ui.employeeFilters.status)}
          ${fieldSelect("type", "Typ", caseTypeOptions(true), ui.employeeFilters.type)}
          <button type="submit" class="button">Filtruj</button>
        </form>
        <div class="case-list" role="list">
          ${cases.map(renderCaseListItem).join("") || emptyStateMarkup("Brak spraw dla wybranych filtrow.")}
        </div>
      </aside>

      <section class="panel case-workspace">
        ${selected ? renderCaseWorkspace(selected) : emptyStateMarkup("Brak spraw do obslugi.")}
      </section>
    </section>

    <section class="panel">
      <details>
        <summary>Rejestracja przez pracownika</summary>
        <form id="employee-create-form" class="form-grid details-form">
          ${fieldSelect("type", "Typ", caseTypeOptions(), CASE_TYPES.COMPLAINT)}
          ${fieldSelect("channel", "Kanal", channelOptions(), CHANNELS.PHONE)}
          ${fieldInput("orderNumber", "Numer zamowienia", "ORD-2026-1002", true)}
          ${fieldInput("email", "E-mail", "anna.nowak@example.com", true, "email")}
          ${fieldInput("phone", "Telefon", "+48500500500", false, "tel")}
          ${fieldInput("reason", "Powod", "Zwrot konsumencki", true)}
          <label class="field field-full">
            <span>Opis</span>
            <textarea name="description" rows="4" required></textarea>
          </label>
          ${fieldInput("attachments", "Zalaczniki", "")}
          <div class="form-actions field-full">
            <button type="submit" class="button primary">Dodaj sprawe</button>
          </div>
        </form>
      </details>
    </section>
  `;
}
export function renderManagerView() {
  const today = todayISO();
  const nonFinal = state.cases.filter((item) => !FINAL_STATUSES.has(item.status));
  const escalated = state.cases.filter(
    (item) => item.status === STATUSES.ESCALATED || item.escalations.length > 0,
  );
  const atRisk = nonFinal.filter(
    (item) => daysBetween(today, item.deadlineAt) <= Number(state.config.alertThresholdDays || 0),
  );
  const overdue = nonFinal.filter((item) => daysBetween(today, item.deadlineAt) < 0);
  const report = ui.report || emptyReport();

  return `
    <section class="view-grid">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Kierownik</p>
            <h2>Terminy i eskalacje</h2>
          </div>
          <button type="button" class="button" data-action="evaluate-deadlines">Ocen terminy</button>
        </div>
        <div class="metric-grid">
          ${metricCard("Aktywne", nonFinal.length)}
          ${metricCard("Ryzyko terminu", atRisk.length)}
          ${metricCard("Po terminie", overdue.length)}
          ${metricCard("Eskalacje", escalated.length)}
        </div>
        <form id="escalation-form" class="form-grid compact-top">
          ${fieldSelect("caseId", "Sprawa", caseOptions(nonFinal), nonFinal[0]?.id || "")}
          ${fieldInput("reason", "Powod eskalacji", "Ryzyko terminu ustawowego", true)}
          <div class="form-actions field-full">
            <button type="submit" class="button primary" ${nonFinal.length ? "" : "disabled"}>Eskaluj</button>
          </div>
        </form>
        <div class="data-list">
          ${escalated.map(renderEscalationItem).join("") || emptyStateMarkup("Brak eskalacji.")}
        </div>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Raport</p>
            <h2>Wyniki obslugi</h2>
          </div>
        </div>
        <form id="report-form" class="compact-form report-form">
          ${fieldInput("from", "Od", ui.reportFilters.from, false, "date")}
          ${fieldInput("to", "Do", ui.reportFilters.to, false, "date")}
          ${fieldSelect("type", "Typ", caseTypeOptions(true), ui.reportFilters.type)}
          ${fieldSelect("status", "Status", statusOptions(true), ui.reportFilters.status)}
          ${fieldInput("category", "Kategoria", ui.reportFilters.category)}
          <button type="submit" class="button">Generuj</button>
        </form>
        ${ui.report ? renderReport(report) : emptyStateMarkup("Wybierz filtry i wygeneruj raport z API.")}
      </section>
    </section>
  `;
}
export function renderAdminView() {
  const editing = state.users.find((item) => item.id === ui.editingUserId);

  return `
    <section class="admin-layout">
      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Admin</p>
            <h2>Konfiguracja terminow</h2>
          </div>
          <button type="button" class="button subtle" data-action="reset-demo">Reset demo</button>
        </div>
        <form id="config-form" class="form-grid">
          ${fieldInput("complaintDeadlineDays", "Termin reklamacji", state.config.complaintDeadlineDays, true, "number")}
          ${fieldInput("returnDeadlineDays", "Termin zwrotu", state.config.returnDeadlineDays, true, "number")}
          ${fieldInput("alertThresholdDays", "Prog alertu", state.config.alertThresholdDays, true, "number")}
          ${fieldInput("staleEscalationDays", "Brak zmiany", state.config.staleEscalationDays, true, "number")}
          <div class="form-actions field-full">
            <button type="submit" class="button primary">Zapisz konfiguracje</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">RBAC</p>
            <h2>Uzytkownicy</h2>
          </div>
        </div>
        <form id="user-form" class="form-grid">
          <input type="hidden" name="id" value="${escapeAttr(editing?.id || "")}" />
          ${fieldInput("name", "Imie i nazwisko", editing?.name || "", true)}
          ${fieldInput("email", "E-mail", editing?.email || "", true, "email")}
          ${fieldSelect("role", "Rola", roleOptions(), editing?.role || ROLES.EMPLOYEE)}
          <label class="checkbox-field">
            <input type="checkbox" name="active" ${editing?.active ?? true ? "checked" : ""} />
            <span>Aktywny</span>
          </label>
          <div class="form-actions field-full">
            <button type="submit" class="button primary">${editing ? "Zapisz uzytkownika" : "Dodaj uzytkownika"}</button>
          </div>
        </form>
        <div class="table-wrap">
          <table class="users-table">
            <colgroup>
              <col class="col-name" />
              <col class="col-role" />
              <col class="col-status" />
              <col class="col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Rola</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${state.users.map(renderUserRow).join("") || `<tr><td colspan="4">${emptyStateMarkup("Brak uzytkownikow z API.")}</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}
export function renderCaseWorkspace(item) {
  const isReturn = item.type === CASE_TYPES.RETURN;
  const hasDecision = Boolean(item.decision);
  const canGenerateLabel = isReturn && !item.returnLabel && !hasDecision;
  const canConfirmWms = isReturn && item.returnLabel && item.status === STATUSES.WAITING_FOR_GOODS;

  return `
    <div class="case-header">
      <div>
        <p class="eyebrow">${labelFor(item.type)} - ${labelFor(item.channel)}</p>
        <h2>${escapeHtml(item.number)}</h2>
      </div>
      ${statusChip(item.status)}
    </div>

    <dl class="facts-grid">
      ${fact("Klient", item.customerName)}
      ${fact("E-mail", item.email)}
      ${fact("Zamowienie", item.orderNumber)}
      ${fact("Produkt", item.product)}
      ${fact("Termin", `${item.deadlineAt} (${daysBetween(todayISO(), item.deadlineAt)} dni)`)}
      ${fact("Priorytet", item.priority)}
    </dl>

    <section class="case-section">
      <h3>Opis</h3>
      <p>${escapeHtml(item.description)}</p>
      <p class="muted">Powod: ${escapeHtml(item.reason)}</p>
      ${item.attachments.length ? `<p class="muted">Zalaczniki: ${item.attachments.map(escapeHtml).join(", ")}</p>` : ""}
    </section>

    ${item.returnLabel ? renderReturnLabel(item.returnLabel) : ""}
    ${item.decision ? renderDecision(item.decision) : ""}

    <section class="case-actions">
      <form id="status-form" class="action-card">
        <input type="hidden" name="caseId" value="${escapeAttr(item.id)}" />
        <h3>Status</h3>
        ${fieldSelect("status", "Nowy status", statusOptions(), item.status)}
        <label class="field">
          <span>Komentarz</span>
          <textarea name="comment" rows="3" placeholder="Komentarz do historii"></textarea>
        </label>
        <button type="submit" class="button primary">Zmien status</button>
      </form>

      <div class="action-card">
        <h3>Zwrot fizyczny</h3>
        <label class="field">
          <span>Kurier</span>
          <select id="label-courier">
            <option>InPost</option>
            <option>DPD</option>
            <option>DHL</option>
          </select>
        </label>
        <button type="button" class="button" data-action="generate-label" data-case-id="${escapeAttr(item.id)}" ${canGenerateLabel ? "" : "disabled"}>Generuj etykiete</button>
        <label class="field">
          <span>Stan z WMS</span>
          <input id="wms-condition" value="Towar kompletny" />
        </label>
        <button type="button" class="button" data-action="wms-receipt" data-case-id="${escapeAttr(item.id)}" ${canConfirmWms ? "" : "disabled"}>Potwierdz odbior</button>
      </div>

      <form id="decision-form" class="action-card">
        <input type="hidden" name="caseId" value="${escapeAttr(item.id)}" />
        <h3>Decyzja</h3>
        ${fieldSelect("type", "Typ decyzji", decisionOptions(), DECISION_TYPES.REPAIR, hasDecision)}
        <label class="field">
          <span>Uzasadnienie</span>
          <textarea name="justification" rows="3" ${hasDecision ? "disabled" : ""}></textarea>
        </label>
        <button type="submit" class="button primary" ${hasDecision ? "disabled" : ""}>Zatwierdz decyzje</button>
      </form>
    </section>

    <section class="case-section">
      <h3>Historia statusow</h3>
      <div class="timeline">
        ${item.history.map(renderHistoryItem).join("") || emptyStateMarkup("Brak historii.")}
      </div>
    </section>
  `;
}
export function renderLookupResult() {
  if (!ui.lookup) {
    return `
      <div class="empty-state">
        <h2>Brak aktywnego wyszukiwania</h2>
        <p>Wynik pojawi sie po sprawdzeniu numeru sprawy i e-maila.</p>
      </div>
    `;
  }

  if (!ui.lookup.case) {
    return `
      <div class="empty-state">
        <h2>Status niedostepny</h2>
        <p>Nie odnaleziono sprawy dla podanych danych.</p>
      </div>
    `;
  }

  const item = ui.lookup.case;
  return `
    <div class="case-header">
      <div>
        <p class="eyebrow">${labelFor(item.type)}</p>
        <h2>${escapeHtml(item.number)}</h2>
      </div>
      ${statusChip(item.status)}
    </div>
    <dl class="facts-grid">
      ${fact("Produkt", item.product)}
      ${fact("Termin", item.deadlineAt)}
      ${fact("Kanal", labelFor(item.channel))}
      ${fact("Priorytet", item.priority)}
    </dl>
    ${item.decision ? renderDecision(item.decision) : ""}
    <div class="timeline public-timeline">
      ${item.history.map(renderHistoryItem).join("") || emptyStateMarkup("Brak historii publicznej.")}
    </div>
  `;
}
