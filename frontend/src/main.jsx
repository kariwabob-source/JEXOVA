import React from "react";
import { createRoot } from "react-dom/client";
import "../css/tokens.css";
import "../css/base.css";
import "../css/layout.css";
import "../css/components.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
