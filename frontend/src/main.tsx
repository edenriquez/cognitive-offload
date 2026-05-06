import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import "./styles/globals.css";

// Global error handler — catches anything React misses
window.addEventListener("error", (event) => {
  console.error(
    "[global error]",
    event.error?.message ?? event.message,
    event.error?.stack,
  );
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[unhandled promise]", event.reason?.message ?? event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
