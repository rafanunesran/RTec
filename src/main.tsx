import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
import { registerServiceWorker } from "./lib/pwa";
import { setupTvNavigation } from "./lib/tvnav";
import { releaseTvOrientation } from "./lib/orientation";

registerServiceWorker();
setupTvNavigation();
releaseTvOrientation();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster theme="dark" richColors position="top-right" />
    </BrowserRouter>
  </React.StrictMode>,
);
