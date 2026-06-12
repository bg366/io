import { apiRequest } from "./api.js";
import { TOKEN_KEY } from "./constants.js";
import { render, ensureSelectedCase } from "./render.js";
import { casePayload, extractArray, extractCase, normalizeBootstrap, normalizeCase, normalizeReport, normalizeUser } from "./normalizers.js";
import { clearMessage, clearSession, session, setMessage, setState, state, ui } from "./state.js";
import { cleanedFilters, errorMessage, formData, queryString } from "./utils.js";

export async function initialize() {
  render();

  await refreshBootstrap();

  if (session.token) {
    await loadCurrentUser();
  }

  render();
}
export async function handleClick(event) {
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
export async function handleSubmit(event) {
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
    setState(normalizeBootstrap(result));
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
    setState({
      ...state,
      cases: extractArray(result, "cases").map(normalizeCase),
    });
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
