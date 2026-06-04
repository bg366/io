import { handleClick, handleSubmit, initialize } from "./app/actions.js";

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", (event) => {
    void handleClick(event);
  });
  document.body.addEventListener("submit", (event) => {
    void handleSubmit(event);
  });
  void initialize();
});
