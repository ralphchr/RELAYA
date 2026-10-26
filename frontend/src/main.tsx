import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App.js";
import { startMonitoring } from "./lib/monitoring.js";
import "./styles/tokens.css";
import "./styles/base.css";
import "./components/ui/ui.css";

startMonitoring();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
