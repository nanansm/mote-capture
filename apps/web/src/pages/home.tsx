import { Navigate } from "react-router-dom";

// Ported from apps/cloud/app/page.tsx, which was just `redirect("/admin")`.
export default function Home() {
  return <Navigate to="/admin" replace />;
}
