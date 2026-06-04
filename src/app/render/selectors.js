import { state, ui } from "../state.js";

export function filteredCases() {
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
export function selectedCase() {
  return state.cases.find((item) => item.id === ui.selectedCaseId) || state.cases[0] || null;
}
export function ensureSelectedCase() {
  if (!state.cases.length) {
    ui.selectedCaseId = null;
    return;
  }
  if (!state.cases.some((item) => item.id === ui.selectedCaseId)) {
    ui.selectedCaseId = state.cases[0].id;
  }
}
