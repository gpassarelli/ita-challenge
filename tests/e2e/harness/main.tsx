import React from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceApp } from "../../../src/components/workspace";
import "../../../src/app/globals.css";
createRoot(document.getElementById("root")!).render(
  <WorkspaceApp
    connected
    user={{
      id: "00000000-0000-4000-8000-000000000001",
      email: "teste@isolado.invalid",
    }}
  />,
);
