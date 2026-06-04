import { main } from "./dom.js";
import { ui } from "./state.js";
import { emptyStateMarkup } from "./render/forms.js";
import { ensureSelectedCase } from "./render/selectors.js";
import { renderClientView, renderEmployeeView, renderManagerView, renderAdminView, renderSessionPanel, renderStatusView } from "./render/views.js";
import { renderMessage, renderOperations, renderSystemSummary, renderTabs } from "./render/operations.js";

export { ensureSelectedCase };

export function render() {
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
