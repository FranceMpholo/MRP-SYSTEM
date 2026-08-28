import React from "react";
import ReactDOM from "react-dom/client";
import MRPPlanner from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div style={{ maxWidth: 1200, margin: "24px auto", padding: "0 16px" }}>
      <MRPPlanner />
    </div>
  </React.StrictMode>
);
