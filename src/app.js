import {
  CASE_TYPES,
  CHANNELS,
  DECISION_TYPES,
  FINAL_STATUSES,
  ROLES,
  STATUSES,
  createCase,
  createDecision,
  createDemoState,
  confirmWmsReceipt,
  escalateCase,
  evaluateDeadlines,
  generateReport,
  generateReturnLabel,
  lookupCase,
  saveUser,
  updateConfiguration,
  updateStatus,
} from "./domain.js";

const STORAGE_KEY = "szrz-poc-state-v1";

const labels = {
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

const ui = {
  activeTab: "client",
  selectedCaseId: null,
  editingUserId: null,
  lookup: null,
  message: null,
  employeeFilters: {
    query: "",
    status: "",
    type: "",
  },
  reportFilters: {
    from: "",
    to: "",
    type: "",
    status: "",
    category: "",
  },
};

let state = loadState();
ui.selectedCaseId = state.cases[0]?.id || null;

const main = document.querySelector("#main");
const tabs = document.querySelector("#tabs");
const message = document.querySelector("#message");
const systemSummary = document.querySelector("#system-summary");
const notificationCount = document.querySelector("#notification-count");
const auditCount = document.querySelector("#audit-count");
const notificationList = document.querySelector("#notifications");
const auditLog = document.querySelector("#audit-log");

document.addEventListener("DOMContentLoaded", render);
document.body.addEventListener("click", handleClick);
document.body.addEventListener("submit", handleSubmit);

function handleClick(event) {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    ui.activeTab = tab.dataset.tab;
    clearMessage();
    render();
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;

  const { action: name, caseId, userId } = action.dataset;

  if (name === "select-case") {
    ui.selectedCaseId = caseId;
    render();
    return;
  }

  if (name === "evaluate-deadlines") {
    mutate(() => evaluateDeadlines(state), "Reguly terminow zostaly ocenione.");
    return;
  }

  if (name === "reset-demo") {
    state = createDemoState();
    ui.selectedCaseId = state.cases[0]?.id || null;
    ui.lookup = null;
    ui.editingUserId = null;
    persistState();
    setMessage("Przywrocono dane demonstracyjne.", "success");
    render();
    return;
  }

  if (name === "generate-label") {
    const courier = document.querySelector("#label-courier")?.value || "InPost";
    mutate(
      () => generateReturnLabel(state, caseId, courier, actorFor(ROLES.EMPLOYEE)),
      "Wygenerowano etykiete zwrotna.",
    );
    return;
  }

  if (name === "wms-receipt") {
    const condition = document.querySelector("#wms-condition")?.value || "Towar kompletny";
    mutate(() => confirmWmsReceipt(state, caseId, condition), "Mock WMS potwierdzil odbior.");
    return;
  }

  if (name === "edit-user") {
    ui.editingUserId = userId;
    render();
    return;
  }

  if (name === "toggle-user") {
    const user = state.users.find((item) => item.id === userId);
    if (!user) return;
    mutate(
      () => saveUser(state, { ...user, active: !user.active }, actorFor(ROLES.ADMIN)),
      user.active ? "Uzytkownik zostal dezaktywowany." : "Uzytkownik zostal aktywowany.",
    );
  }
}

function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  const formId = form.getAttribute("id");
  const data = formData(form);

  if (formId === "client-form") {
    mutate(() => {
      const result = createCase(state, data, actorFor(ROLES.CLIENT));
      ui.lookup = {
        case: result.case,
        number: result.case.number,
        email: result.case.email,
      };
      ui.selectedCaseId = result.case.id;
      form.reset();
      return result;
    }, "Zgloszenie zostalo zarejestrowane.");
    return;
  }

  if (formId === "lookup-form") {
    const found = lookupCase(state, data.number, data.email);
    ui.lookup = found
      ? { case: found, number: data.number, email: data.email }
      : { case: null, number: data.number, email: data.email };
    setMessage(found ? "Odnaleziono status zgloszenia." : "Nie odnaleziono sprawy dla podanych danych.", found ? "success" : "error");
    render();
    return;
  }

  if (formId === "employee-create-form") {
    mutate(() => {
      const result = createCase(state, data, actorFor(ROLES.EMPLOYEE));
      ui.selectedCaseId = result.case.id;
      return result;
    }, "Zgloszenie obslugowe zostalo dodane.");
    return;
  }

  if (formId === "employee-filters") {
    ui.employeeFilters = {
      query: data.query || "",
      status: data.status || "",
      type: data.type || "",
    };
    render();
    return;
  }

  if (formId === "status-form") {
    mutate(
      () =>
        updateStatus(
          state,
          data.caseId,
          data.status,
          actorFor(ROLES.EMPLOYEE),
          data.comment,
        ),
      "Status zostal zmieniony.",
    );
    return;
  }

  if (formId === "decision-form") {
    mutate(
      () =>
        createDecision(
          state,
          data.caseId,
          { type: data.type, justification: data.justification, final: true },
          actorFor(ROLES.EMPLOYEE),
        ),
      "Decyzja zostala zatwierdzona.",
    );
    return;
  }

  if (formId === "escalation-form") {
    mutate(
      () => escalateCase(state, data.caseId, data.reason, actorFor(ROLES.MANAGER)),
      "Zgloszenie zostalo eskalowane.",
    );
    return;
  }

  if (formId === "report-form") {
    ui.reportFilters = {
      from: data.from || "",
      to: data.to || "",
      type: data.type || "",
      status: data.status || "",
      category: data.category || "",
    };
    setMessage("Raport zostal odswiezony.", "success");
    render();
    return;
  }

  if (formId === "config-form") {
    mutate(
      () =>
        updateConfiguration(
          state,
          {
            complaintDeadlineDays: data.complaintDeadlineDays,
            returnDeadlineDays: data.returnDeadlineDays,
            alertThresholdDays: data.alertThresholdDays,
            staleEscalationDays: data.staleEscalationDays,
          },
          actorFor(ROLES.ADMIN),
        ),
      "Konfiguracja zostala zapisana.",
    );
    return;
  }

  if (formId === "user-form") {
    mutate(
      () =>
        saveUser(
          state,
          {
            id: data.id || undefined,
            name: data.name,
            email: data.email,
            role: data.role,
            active: data.active === "on",
          },
          actorFor(ROLES.ADMIN),
        ),
      data.id ? "Uzytkownik zostal zaktualizowany." : "Uzytkownik zostal dodany.",
    );
    ui.editingUserId = null;
  }
}

function render() {
  ensureSelectedCase();
  renderSystemSummary();
  renderTabs();
  renderMessage();

  const views = {
    client: renderClientView,
    status: renderStatusView,
    employee: renderEmployeeView,
    manager: renderManagerView,
    admin: renderAdminView,
  };

  main.innerHTML = views[ui.activeTab]?.() || renderClientView();
  renderOperations();
}

function renderClientView() {
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
          ${state.orders.map(renderOrderItem).join("")}
        </div>
      </section>
    </section>
  `;
}

function renderStatusView() {
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

function renderEmployeeView() {
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
          ${cases.map(renderCaseListItem).join("") || emptyState("Brak spraw dla wybranych filtrow.")}
        </div>
      </aside>

      <section class="panel case-workspace">
        ${selected ? renderCaseWorkspace(selected) : emptyState("Brak spraw do obslugi.")}
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

function renderManagerView() {
  const today = todayISO();
  const nonFinal = state.cases.filter((item) => !FINAL_STATUSES.has(item.status));
  const escalated = state.cases.filter(
    (item) => item.status === STATUSES.ESCALATED || item.escalations.length > 0,
  );
  const atRisk = nonFinal.filter(
    (item) => daysBetween(today, item.deadlineAt) <= state.config.alertThresholdDays,
  );
  const overdue = nonFinal.filter((item) => daysBetween(today, item.deadlineAt) < 0);
  const report = generateReport(state, cleanedFilters(ui.reportFilters));

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
          ${escalated.map(renderEscalationItem).join("") || emptyState("Brak eskalacji.")}
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
        ${renderReport(report)}
      </section>
    </section>
  `;
}

function renderAdminView() {
  const editing = state.users.find((item) => item.id === ui.editingUserId);

  return `
    <section class="view-grid">
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
          <table>
            <thead>
              <tr>
                <th>Nazwa</th>
                <th>Rola</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${state.users.map(renderUserRow).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderCaseWorkspace(item) {
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
        ${item.history.map(renderHistoryItem).join("")}
      </div>
    </section>
  `;
}

function renderLookupResult() {
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
      ${item.history.map(renderHistoryItem).join("")}
    </div>
  `;
}

function renderOperations() {
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
      .join("") || emptyState("Brak powiadomien.");

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
      .join("") || emptyState("Brak wpisow audytu.");
}

function renderSystemSummary() {
  const active = state.cases.filter((item) => !FINAL_STATUSES.has(item.status)).length;
  const escalated = state.cases.filter((item) => item.status === STATUSES.ESCALATED).length;
  systemSummary.innerHTML = `
    <span>${state.cases.length} spraw</span>
    <span>${active} aktywne</span>
    <span>${escalated} eskalowane</span>
  `;
}

function renderTabs() {
  for (const button of tabs.querySelectorAll("[data-tab]")) {
    const selected = button.dataset.tab === ui.activeTab;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-current", selected ? "page" : "false");
  }
}

function renderMessage() {
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

function renderOrderItem(order) {
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

function renderCaseListItem(item) {
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

function renderEscalationItem(item) {
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

function renderReport(report) {
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

function renderCountList(data) {
  const items = Object.entries(data)
    .map(([key, count]) => `<li><span>${escapeHtml(labelFor(key))}</span><strong>${count}</strong></li>`)
    .join("");
  return `<ul class="count-list">${items || "<li><span>Brak danych</span><strong>0</strong></li>"}</ul>`;
}

function renderUserRow(user) {
  return `
    <tr>
      <td>
        <strong>${escapeHtml(user.name)}</strong>
        <small>${escapeHtml(user.email)}</small>
      </td>
      <td>${escapeHtml(labelFor(user.role))}</td>
      <td>${user.active ? "Aktywny" : "Nieaktywny"}</td>
      <td class="table-actions">
        <button type="button" class="button subtle" data-action="edit-user" data-user-id="${escapeAttr(user.id)}">Edytuj</button>
        <button type="button" class="button subtle" data-action="toggle-user" data-user-id="${escapeAttr(user.id)}">${user.active ? "Dezaktywuj" : "Aktywuj"}</button>
      </td>
    </tr>
  `;
}

function renderHistoryItem(item) {
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

function renderReturnLabel(label) {
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

function renderDecision(decision) {
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

function metricCard(label, value) {
  return `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </article>
  `;
}

function statusChip(status) {
  return `<span class="status-chip status-${escapeAttr(status.toLowerCase())}">${escapeHtml(labelFor(status))}</span>`;
}

function fact(label, value) {
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(String(value || "-"))}</dd>
    </div>
  `;
}

function fieldInput(name, label, value = "", required = false, type = "text") {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input type="${escapeAttr(type)}" name="${escapeAttr(name)}" value="${escapeAttr(value)}" ${required ? "required" : ""} />
    </label>
  `;
}

function fieldSelect(name, label, options, selected = "", disabled = false) {
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

function emptyState(text) {
  return `<div class="empty-state"><p>${escapeHtml(text)}</p></div>`;
}

function caseTypeOptions(withBlank = false) {
  return optionList(CASE_TYPES, withBlank);
}

function channelOptions() {
  return optionList(CHANNELS, false);
}

function statusOptions(withBlank = false) {
  return optionList(STATUSES, withBlank);
}

function decisionOptions() {
  return optionList(DECISION_TYPES, false);
}

function roleOptions() {
  return optionList(ROLES, false);
}

function caseOptions(items) {
  return items.map((item) => ({
    value: item.id,
    label: `${item.number} - ${item.customerName}`,
  }));
}

function optionList(source, withBlank) {
  const options = Object.values(source).map((value) => ({
    value,
    label: labelFor(value),
  }));
  return withBlank ? [{ value: "", label: "Wszystkie" }, ...options] : options;
}

function filteredCases() {
  const query = ui.employeeFilters.query.trim().toLowerCase();
  return state.cases.filter((item) => {
    if (ui.employeeFilters.status && item.status !== ui.employeeFilters.status) return false;
    if (ui.employeeFilters.type && item.type !== ui.employeeFilters.type) return false;
    if (!query) return true;
    return [item.number, item.customerName, item.email, item.orderNumber, item.product]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function selectedCase() {
  return state.cases.find((item) => item.id === ui.selectedCaseId) || state.cases[0] || null;
}

function ensureSelectedCase() {
  if (!state.cases.length) {
    ui.selectedCaseId = null;
    return;
  }
  if (!state.cases.some((item) => item.id === ui.selectedCaseId)) {
    ui.selectedCaseId = state.cases[0].id;
  }
}

function mutate(operation, successMessage) {
  try {
    const result = operation();
    state = result.state;
    persistState();
    setMessage(successMessage, "success");
  } catch (error) {
    setMessage(error.message || "Operacja nie powiodla sie.", "error");
  }
  render();
}

function actorFor(role) {
  const user = state.users.find((item) => item.role === role && item.active);
  if (user) {
    return {
      id: user.id,
      name: user.name,
      role: user.role,
    };
  }
  const fallback = {
    [ROLES.CLIENT]: "Klient",
    [ROLES.EMPLOYEE]: "Pracownik dyzurny",
    [ROLES.MANAGER]: "Kierownik dyzurny",
    [ROLES.ADMIN]: "Administrator",
  };
  return { id: role.toLowerCase(), name: fallback[role], role };
}

function cleanedFilters(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.config && Array.isArray(parsed.cases) && Array.isArray(parsed.users)) {
        return parsed;
      }
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return createDemoState();
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setMessage(text, type = "success") {
  ui.message = { text, type };
}

function clearMessage() {
  ui.message = null;
}

function labelFor(value) {
  return labels[value] || value;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  const from = new Date(`${fromISO}T00:00:00.000Z`);
  const to = new Date(`${toISO}T00:00:00.000Z`);
  return Math.round((to - from) / 86400000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
