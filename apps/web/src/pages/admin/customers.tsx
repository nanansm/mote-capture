import { ComingSoon } from "@/components/admin/coming-soon";

// Ported verbatim from apps/cloud/app/admin/customers/page.tsx — this page
// was already static (no data fetching) in the Next app.
export default function CustomersPage() {
  return <ComingSoon title="Customers" sprint="Sprint 5 (CRM)" />;
}
