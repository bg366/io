import { TOKEN_KEY } from "./constants.js";
import { emptyBootstrap } from "./normalizers.js";

export const ui = {
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

export let state = emptyBootstrap();

export const session = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  user: null,
};

export function setState(nextState) {
  state = nextState;
}

export function clearSession() {
  session.token = "";
  session.user = null;
  localStorage.removeItem(TOKEN_KEY);
}

export function setMessage(text, type = "success") {
  ui.message = { text, type };
}

export function clearMessage() {
  ui.message = null;
}

export function todayISO() {
  return state.today || new Date().toISOString().slice(0, 10);
}
