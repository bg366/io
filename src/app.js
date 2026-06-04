const TOKEN_KEY = "szrz-poc-api-token-v1";

const CASE_TYPES = Object.freeze({
  COMPLAINT: "REKLAMACJA",
  RETURN: "ZWROT",
});

const CHANNELS = Object.freeze({
  ONLINE: "ONLINE",
  EMAIL: "EMAIL",
  PHONE: "TELEFON",
  IN_PERSON: "OSOBISCIE",
});

const STATUSES = Object.freeze({
  NEW: "NOWE",
  IN_PROGRESS: "W_TRAKCIE",
  WAITING_FOR_GOODS: "OCZEKUJE_NA_TOWAR",
  DECIDED: "ROZPATRZONE",
  CLOSED: "ZAMKNIETE",
  ESCALATED: "ESKALOWANE",
});

const DECISION_TYPES = Object.freeze({
  REPAIR: "NAPRAWA",
  REPLACE: "WYMIANA",
  REFUND: "ZWROT_GOTOWKI",
  PRICE_REDUCTION: "OBNIZENIE_CENY",
  REJECT: "ODRZUCENIE",
});

const ROLES = Object.freeze({
  CLIENT: "KLIENT",
  EMPLOYEE: "PRACOWNIK_OBSLUGI",
  MANAGER: "KIEROWNIK",
  ADMIN: "ADMINISTRATOR",
});

const DEFAULT_CONFIG = Object.freeze({
  complaintDeadlineDays: 30,
  returnDeadlineDays: 14,
  alertThresholdDays: 2,
  staleEscalationDays: 5,
});

const FINAL_STATUSES = new Set([STATUSES.DECIDED, STATUSES.CLOSED]);

const demoAccounts = [
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
  loading: true,
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
  report: null,
};

let state = emptyBootstrap();
const session = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  user: null,
};

const main = document.querySelector("#main");
const tabs = document.querySelector("#tabs");
const message = document.querySelector("#message");
const systemSummary = document.querySelector("#system-summary");
const sessionPanel = document.querySelector("#session-panel");
const notificationCount = document.querySelector("#notification-count");
const auditCount = document.querySelector("#audit-count");
const notificationList = document.querySelector("#notifications");
const auditLog = document.querySelector("#audit-log");

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", (event) => {
    void handleClick(event);
  });
  document.body.addEventListener("submit", (event) => {
    void handleSubmit(event);
  });
  void initialize();
});

async function initialize() {
  render();

  await refreshBootstrap();

  if (session.token) {
    await loadCurrentUser();
  }

  render();
}

async function handleClick(event) {
  const tab = event.target.closest("[data-tab]");
  if (tab) {
    ui.activeTab = tab.dataset.tab;
    clearMessage();
    render();
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;

  const { action: name, caseId, userId, email, password } = action.dataset;

  if (name === "select-case") {
    ui.selectedCaseId = caseId;
    render();
    return;
  }

  if (name === "demo-login") {
    await login(email, password);
    return;
  }

  if (name === "logout") {
    clearSession();
    setMessage("Wylogowano.", "success");
    render();
    return;
  }

  if (name === "evaluate-deadlines") {
    await mutateRemote(
      () => apiRequest("/api/deadlines/evaluate", { method: "POST", requireAuth: true }),
      "Reguly terminow zostaly ocenione.",
    );
    return;
  }

  if (name === "reset-demo") {
    await mutateRemote(
      () => apiRequest("/api/reset-demo", { method: "POST", requireAuth: true }),
      "Przywrocono dane demonstracyjne.",
      () => {
        ui.lookup = null;
        ui.editingUserId = null;
        ui.report = null;
      },
    );
    return;
  }

  if (name === "generate-label") {
    const courier = document.querySelector("#label-courier")?.value || "InPost";
    await mutateRemote(
      () =>
        apiRequest(`/api/cases/${encodeURIComponent(caseId)}/return-label`, {
          method: "POST",
          body: { courier },
          requireAuth: true,
        }),
      "Wygenerowano etykiete zwrotna.",
    );
    return;
  }

  if (name === "wms-receipt") {
    const condition = document.querySelector("#wms-condition")?.value || "Towar kompletny";
    await mutateRemote(
      () =>
        apiRequest(`/api/cases/${encodeURIComponent(caseId)}/wms-receipt`, {
          method: "POST",
          body: { condition },
          requireAuth: true,
        }),
      "Mock WMS potwierdzil odbior.",
    );
    return;
  }

  if (name === "edit-user") {
    ui.editingUserId = userId;
    render();
    return;
  }

  if (name === "toggle-user") {
    await mutateRemote(
      () =>
        apiRequest(`/api/users/${encodeURIComponent(userId)}/toggle`, {
          method: "POST",
          requireAuth: true,
        }),
      "Status uzytkownika zostal zmieniony.",
    );
  }
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();

  const formId = form.getAttribute("id");
  const data = formData(form);

  if (formId === "login-form") {
    await login(data.email, data.password);
    return;
  }

  if (formId === "client-form") {
    await mutateRemote(
      async () => {
        const result = await apiRequest("/api/cases", {
          method: "POST",
          body: casePayload(data),
        });
        const complaintCase = extractCase(result);
        if (complaintCase) {
          ui.lookup = {
            case: normalizeCase(complaintCase),
            number: complaintCase.number,
            email: complaintCase.email || data.email,
          };
          ui.selectedCaseId = complaintCase.id;
        }
        form.reset();
        return result;
      },
      "Zgloszenie zostalo zarejestrowane.",
    );
    return;
  }

  if (formId === "lookup-form") {
    await lookupPublicStatus(data.number, data.email);
    return;
  }

  if (formId === "employee-create-form") {
    await mutateRemote(
      async () => {
        const result = await apiRequest("/api/cases", {
          method: "POST",
          body: casePayload(data),
          requireAuth: true,
        });
        const complaintCase = extractCase(result);
        if (complaintCase) {
          ui.selectedCaseId = complaintCase.id;
        }
        return result;
      },
      "Zgloszenie obslugowe zostalo dodane.",
    );
    return;
  }

  if (formId === "employee-filters") {
    ui.employeeFilters = {
      query: data.query || "",
      status: data.status || "",
      type: data.type || "",
    };
    await loadCases(ui.employeeFilters);
    setMessage("Kolejka spraw zostala odswiezona.", "success");
    render();
    return;
  }

  if (formId === "status-form") {
    await mutateRemote(
      () =>
        apiRequest(`/api/cases/${encodeURIComponent(data.caseId)}/status`, {
          method: "PUT",
          body: {
            status: data.status,
            comment: data.comment,
          },
          requireAuth: true,
        }),
      "Status zostal zmieniony.",
    );
    return;
  }

  if (formId === "decision-form") {
    await mutateRemote(
      () =>
        apiRequest(`/api/cases/${encodeURIComponent(data.caseId)}/decision`, {
          method: "POST",
          body: {
            type: data.type,
            justification: data.justification,
          },
          requireAuth: true,
        }),
      "Decyzja zostala zatwierdzona.",
    );
    return;
  }

  if (formId === "escalation-form") {
    await mutateRemote(
      () =>
        apiRequest(`/api/cases/${encodeURIComponent(data.caseId)}/escalate`, {
          method: "POST",
          body: { reason: data.reason },
          requireAuth: true,
        }),
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
    await loadReport();
    return;
  }

  if (formId === "config-form") {
    await mutateRemote(
      () =>
        apiRequest("/api/config", {
          method: "PUT",
          body: {
            complaintDeadlineDays: Number(data.complaintDeadlineDays),
            returnDeadlineDays: Number(data.returnDeadlineDays),
            alertThresholdDays: Number(data.alertThresholdDays),
            staleEscalationDays: Number(data.staleEscalationDays),
          },
          requireAuth: true,
        }),
      "Konfiguracja zostala zapisana.",
    );
    return;
  }

  if (formId === "user-form") {
    const payload = {
      name: data.name,
      email: data.email,
      role: data.role,
      active: data.active === "on",
    };
    const editing = Boolean(data.id);
    await mutateRemote(
      () =>
        apiRequest(editing ? `/api/users/${encodeURIComponent(data.id)}` : "/api/users", {
          method: editing ? "PUT" : "POST",
          body: payload,
          requireAuth: true,
        }),
      editing ? "Uzytkownik zostal zaktualizowany." : "Uzytkownik zostal dodany.",
      () => {
        ui.editingUserId = null;
      },
    );
  }
}

function render() {
  ensureSelectedCase();
  renderSystemSummary();
  renderTabs();
  renderSessionPanel();
  renderMessage();

  if (ui.loading) {
    main.innerHTML = `
      <section class="panel">
        ${emptyStateMarkup("Ladowanie danych z API...")}
      </section>
    `;
    renderOperations();
    return;
  }

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

function renderSessionPanel() {
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
          ${state.orders.map(renderOrderItem).join("") || emptyStateMarkup("Brak zamowien z API.")}
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

function renderManagerView() {
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
              ${state.users.map(renderUserRow).join("") || `<tr><td colspan="4">${emptyStateMarkup("Brak uzytkownikow z API.")}</td></tr>`}
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
        ${item.history.map(renderHistoryItem).join("") || emptyStateMarkup("Brak historii.")}
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
      ${item.history.map(renderHistoryItem).join("") || emptyStateMarkup("Brak historii publicznej.")}
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

function statusChip(status = STATUSES.NEW) {
  return `<span class="status-chip status-${escapeAttr(String(status).toLowerCase())}">${escapeHtml(labelFor(status))}</span>`;
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
  const autocomplete = autocompleteFor(name, type);
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input type="${escapeAttr(type)}" name="${escapeAttr(name)}" value="${escapeAttr(value)}" ${autocomplete ? `autocomplete="${escapeAttr(autocomplete)}"` : ""} ${required ? "required" : ""} />
    </label>
  `;
}

function autocompleteFor(name, type) {
  if (type === "password") return "current-password";
  if (type === "email") return "email";
  if (type === "tel") return "tel";
  if (name === "name") return "name";
  return "";
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

function emptyStateMarkup(text) {
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

async function login(email, password) {
  try {
    const result = await apiRequest("/api/auth/login", {
      method: "POST",
      body: { email, password },
      skipAuth: true,
    });
    session.token = result.token || "";
    session.user = normalizeUser(result.user || {});
    if (!session.token) {
      throw new Error("API logowania nie zwrocilo tokenu.");
    }
    localStorage.setItem(TOKEN_KEY, session.token);
    await refreshBootstrap({ silent: true });
    setMessage(`Zalogowano jako ${session.user.name || session.user.email}.`, "success");
  } catch (error) {
    clearSession();
    setMessage(errorMessage(error), "error");
  }
  render();
}

async function loadCurrentUser() {
  try {
    const result = await apiRequest("/api/auth/me", { requireAuth: true });
    session.user = normalizeUser(result.user || result);
  } catch (error) {
    clearSession();
    setMessage(`Sesja wygasla lub jest nieprawidlowa. ${errorMessage(error)}`, "error");
  }
}

async function refreshBootstrap(options = {}) {
  const { silent = false } = options;
  if (!silent) {
    ui.loading = true;
    render();
  }

  try {
    const result = await apiRequest("/api/bootstrap", { skipAuth: true });
    state = normalizeBootstrap(result);
    ensureSelectedCase();
  } catch (error) {
    setMessage(errorMessage(error), "error");
  } finally {
    ui.loading = false;
  }
}

async function loadCases(filters) {
  try {
    const result = await apiRequest(`/api/cases?${queryString(cleanedFilters(filters))}`, {
      requireAuth: true,
    });
    state = {
      ...state,
      cases: extractArray(result, "cases").map(normalizeCase),
    };
    ensureSelectedCase();
  } catch (error) {
    setMessage(errorMessage(error), "error");
  }
}

async function loadReport() {
  try {
    const result = await apiRequest(`/api/reports?${queryString(cleanedFilters(ui.reportFilters))}`, {
      requireAuth: true,
    });
    ui.report = normalizeReport(result);
    setMessage("Raport zostal odswiezony.", "success");
  } catch (error) {
    setMessage(errorMessage(error), "error");
  }
  render();
}

async function lookupPublicStatus(number, email) {
  try {
    const result = await apiRequest(
      `/api/cases/status?${queryString({
        number,
        email,
      })}`,
      { skipAuth: true },
    );
    const found = extractCase(result);
    ui.lookup = {
      case: found ? normalizeCase(found) : null,
      number,
      email,
    };
    setMessage(found ? "Odnaleziono status zgloszenia." : "Status niedostepny dla podanych danych.", found ? "success" : "error");
  } catch (error) {
    ui.lookup = { case: null, number, email };
    setMessage(errorMessage(error), "error");
  }
  render();
}

async function mutateRemote(operation, successMessage, afterSuccess) {
  try {
    const result = await operation();
    if (afterSuccess) afterSuccess(result);
    await refreshBootstrap({ silent: true });
    setMessage(successMessage, "success");
  } catch (error) {
    setMessage(errorMessage(error), "error");
  }
  render();
}

async function apiRequest(path, options = {}) {
  const {
    method = "GET",
    body,
    requireAuth = false,
    skipAuth = false,
  } = options;

  if (requireAuth && !session.token) {
    throw new Error("Ta operacja wymaga zalogowania i odpowiedniej roli.");
  }

  const headers = {
    Accept: "application/json",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (!skipAuth && session.token) {
    headers.Authorization = `Bearer ${session.token}`;
  }

  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Nie mozna polaczyc sie z backendem API. Sprawdz, czy serwer jest uruchomiony.");
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(apiErrorMessage(response, payload));
  }
  return payload;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function apiErrorMessage(response, payload) {
  if (payload?.message) return payload.message;
  if (payload?.error?.message) return payload.error.message;
  if (typeof payload?.error === "string") return payload.error;
  if (payload?.details) return Array.isArray(payload.details) ? payload.details.join(", ") : payload.details;
  if (response.status === 401) return "Nie jestes zalogowany albo sesja wygasla.";
  if (response.status === 403) return "Brak uprawnien do tej operacji.";
  if (response.status === 404) return "Nie znaleziono zasobu w API.";
  return `API zwrocilo blad ${response.status}.`;
}

function normalizeBootstrap(payload) {
  const data = payload || {};
  return {
    config: normalizeConfig(data.config),
    orders: extractArray(data, "orders").map(normalizeOrder),
    cases: extractArray(data, "cases").map(normalizeCase),
    notifications: extractArray(data, "notifications").map(normalizeNotification),
    auditLog: extractArray(data, "auditLog").map(normalizeAuditEntry),
    users: extractArray(data, "users").map(normalizeUser),
    today: data.today || todayISO(),
  };
}

function emptyBootstrap() {
  return {
    config: { ...DEFAULT_CONFIG },
    orders: [],
    cases: [],
    notifications: [],
    auditLog: [],
    users: [],
    today: new Date().toISOString().slice(0, 10),
  };
}

function normalizeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    complaintDeadlineDays: Number(config.complaintDeadlineDays ?? DEFAULT_CONFIG.complaintDeadlineDays),
    returnDeadlineDays: Number(config.returnDeadlineDays ?? DEFAULT_CONFIG.returnDeadlineDays),
    alertThresholdDays: Number(config.alertThresholdDays ?? DEFAULT_CONFIG.alertThresholdDays),
    staleEscalationDays: Number(config.staleEscalationDays ?? DEFAULT_CONFIG.staleEscalationDays),
  };
}

function normalizeOrder(order = {}) {
  return {
    number: order.number || order.orderNumber || "-",
    customerName: order.customerName || order.customer?.name || "-",
    email: order.email || order.customer?.email || "-",
    phone: order.phone || order.customer?.phone || "",
    product: order.product || order.productName || order.products?.[0]?.name || "-",
    category: order.category || order.products?.[0]?.category || "-",
    purchasedAt: order.purchasedAt || order.purchaseDate || "",
  };
}

function normalizeCase(item = {}) {
  const number = item.number || item.caseNumber || item.nr || "-";
  const history = extractArray(item, "history").length
    ? extractArray(item, "history")
    : extractArray(item, "statusHistory");
  return {
    id: String(item.id || item.uuid || number),
    number,
    type: item.type || CASE_TYPES.COMPLAINT,
    channel: item.channel || CHANNELS.ONLINE,
    status: item.status || STATUSES.NEW,
    priority: item.priority || "NORMALNY",
    orderNumber: item.orderNumber || item.order?.number || "",
    customerName: item.customerName || item.customer?.name || "-",
    email: item.email || item.customer?.email || "",
    phone: item.phone || item.customer?.phone || "",
    product: item.product || item.productName || item.order?.product || item.order?.products?.[0]?.name || "-",
    category: item.category || item.order?.category || item.order?.products?.[0]?.category || "-",
    description: item.description || "",
    reason: item.reason || "",
    attachments: normalizeAttachments(item.attachments),
    createdAt: item.createdAt || item.created_at || "",
    deadlineAt: item.deadlineAt || item.deadline || item.termAt || "",
    assignedTo: item.assignedTo || item.assignee?.name || null,
    decision: item.decision ? normalizeDecision(item.decision) : null,
    returnLabel: normalizeReturnLabel(item.returnLabel || item.returnShipment || item.shipment),
    history: history.map(normalizeHistoryItem),
    escalations: extractArray(item, "escalations").map(normalizeEscalation),
  };
}

function normalizeDecision(decision = {}) {
  return {
    id: String(decision.id || ""),
    type: decision.type || DECISION_TYPES.REPAIR,
    justification: decision.justification || "",
    author: decision.author || decision.authorName || decision.user?.name || "-",
    createdAt: decision.createdAt || decision.approvedAt || decision.created_at || "",
    final: Boolean(decision.final ?? decision.approvedAt ?? true),
  };
}

function normalizeReturnLabel(label) {
  if (!label) return null;
  return {
    id: String(label.id || ""),
    courier: label.courier || label.carrier || "-",
    trackingNumber: label.trackingNumber || label.tracking || "-",
    format: label.format || "PDF",
    generatedAt: label.generatedAt || label.createdAt || "",
  };
}

function normalizeHistoryItem(item = {}) {
  return {
    status: item.status || item.newStatus || STATUSES.NEW,
    actor: item.actor || item.actorName || item.user?.name || "System",
    comment: item.comment || item.details || "",
    createdAt: item.createdAt || item.changedAt || item.created_at || "",
  };
}

function normalizeEscalation(item = {}) {
  return {
    id: String(item.id || ""),
    reason: item.reason || item.comment || "Eskalacja",
    author: item.author || item.actor || item.user?.name || "System",
    createdAt: item.createdAt || item.created_at || "",
  };
}

function normalizeNotification(item = {}) {
  return {
    id: String(item.id || ""),
    type: item.type || item.trigger || item.channel || "INFO",
    caseNumber: item.caseNumber || item.number || item.case?.number || "-",
    body: item.body || item.message || item.payload || "",
    recipient: item.recipient || item.email || item.phone || "-",
    createdAt: item.createdAt || item.created_at || "",
  };
}

function normalizeAuditEntry(item = {}) {
  return {
    id: String(item.id || ""),
    action: item.action || item.event || "AUDIT",
    actor: item.actor || item.actorName || item.user?.name || "System",
    details: item.details || item.message || item.description || "",
    createdAt: item.createdAt || item.created_at || "",
  };
}

function normalizeUser(user = {}) {
  return {
    id: String(user.id || user.uuid || user.email || ""),
    name: user.name || user.fullName || user.email || "-",
    email: user.email || "",
    role: user.role || ROLES.CLIENT,
    active: Boolean(user.active ?? user.enabled ?? true),
  };
}

function normalizeReport(report = {}) {
  const source = report.report || report.data?.report || report;
  return {
    total: Number(source.total ?? source.summary?.total ?? 0),
    acceptedPercent: Number(source.acceptedPercent ?? source.summary?.acceptedPercent ?? 0),
    rejectedPercent: Number(source.rejectedPercent ?? source.summary?.rejectedPercent ?? 0),
    averageResolutionDays: Number(source.averageResolutionDays ?? source.summary?.averageResolutionDays ?? 0),
    topReasons: extractArray(source, "topReasons").map((item) => ({
      reason: item.reason || item.name || "-",
      count: Number(item.count || 0),
    })),
    byStatus: source.byStatus || source.statuses || {},
    byType: source.byType || source.types || {},
  };
}

function emptyReport() {
  return {
    total: 0,
    acceptedPercent: 0,
    rejectedPercent: 0,
    averageResolutionDays: 0,
    topReasons: [],
    byStatus: {},
    byType: {},
  };
}

function extractArray(payload, key) {
  const value = payload?.[key];
  if (Array.isArray(value)) return value;
  if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function extractCase(payload) {
  if (!payload) return null;
  if (payload.case) return payload.case;
  if (payload.zgloszenie) return payload.zgloszenie;
  if (payload.data?.case) return payload.data.case;
  if (payload.data?.zgloszenie) return payload.data.zgloszenie;
  if (payload.id || payload.number || payload.caseNumber) return payload;
  return null;
}

function normalizeAttachments(attachments) {
  if (Array.isArray(attachments)) {
    return attachments.map((item) => (typeof item === "string" ? item : item.name || item.filename || "")).filter(Boolean);
  }
  return String(attachments || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function casePayload(data) {
  return {
    type: data.type,
    channel: data.channel || CHANNELS.ONLINE,
    orderNumber: data.orderNumber,
    email: data.email,
    phone: data.phone,
    reason: data.reason,
    description: data.description,
    attachments: normalizeAttachments(data.attachments),
  };
}

function clearSession() {
  session.token = "";
  session.user = null;
  localStorage.removeItem(TOKEN_KEY);
}

function cleanedFilters(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
}

function queryString(params) {
  return new URLSearchParams(cleanedFilters(params)).toString();
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setMessage(text, type = "success") {
  ui.message = { text, type };
}

function clearMessage() {
  ui.message = null;
}

function errorMessage(error) {
  return error?.message || "Operacja nie powiodla sie.";
}

function labelFor(value) {
  return labels[value] || value;
}

function todayISO() {
  return state.today || new Date().toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return 0;
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
