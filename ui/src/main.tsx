import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { usePath } from "./lib/router";
import PublicApp from "./public/PublicApp";

// The admin panel is loaded on demand so people booking a call never download it.
const AdminApp = lazy(() => import("./admin/AdminApp"));

function App() {
  const path = usePath();
  if (path === "/admin" || path.startsWith("/admin/")) {
    return (
      <Suspense fallback={null}>
        <AdminApp />
      </Suspense>
    );
  }
  return <PublicApp />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
