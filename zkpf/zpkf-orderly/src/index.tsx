import React from "react";
import ReactDOM from "react-dom/client";
import AppRoute from "./routes";
import "./styles/index.css";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
root.render(
  <React.StrictMode>
    <AppRoute />
  </React.StrictMode>,
);
