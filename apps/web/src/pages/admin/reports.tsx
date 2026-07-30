import { ComingSoon } from "@/components/admin/coming-soon";

// Ported verbatim from apps/cloud/app/admin/reports/page.tsx — this page was
// already static (no data fetching) in the Next app.
export default function ReportsPage() {
  return <ComingSoon title="Reports" sprint="Sprint 5 (Analytics)" />;
}
