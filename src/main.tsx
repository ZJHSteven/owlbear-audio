import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@awesome.me/webawesome/dist/styles/webawesome.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
