import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "@/pages/home";
import LoginPage from "@/pages/login";
import DownloadPage from "@/pages/download";
import SharePage from "@/pages/share";
import KioskPage from "@/pages/kiosk";
import AdminLayout from "@/pages/admin/layout";
import DashboardPage from "@/pages/admin/dashboard";
import BoothsPage from "@/pages/admin/booths";
import BoothsNewPage from "@/pages/admin/booths-new";
import BoothsDetailPage from "@/pages/admin/booths-detail";
import FramesPage from "@/pages/admin/frames";
import FramesNewPage from "@/pages/admin/frames-new";
import FramesDetailPage from "@/pages/admin/frames-detail";
import SessionsPage from "@/pages/admin/sessions";
import SessionsDetailPage from "@/pages/admin/sessions-detail";
import PaymentsPage from "@/pages/admin/payments";
import PaymentsTransactionsPage from "@/pages/admin/payments-transactions";
import VoucherPage from "@/pages/admin/voucher";
import WhatsappPage from "@/pages/admin/whatsapp";
import SettingsPage from "@/pages/admin/settings";
import CustomersPage from "@/pages/admin/customers";
import ReportsPage from "@/pages/admin/reports";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/download" element={<DownloadPage />} />
      <Route path="/share/:token" element={<SharePage />} />
      <Route path="/kiosk/:boothId" element={<KioskPage />} />

      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="booths" element={<BoothsPage />} />
        <Route path="booths/new" element={<BoothsNewPage />} />
        <Route path="booths/:id" element={<BoothsDetailPage />} />
        <Route path="frames" element={<FramesPage />} />
        <Route path="frames/new" element={<FramesNewPage />} />
        <Route path="frames/:id" element={<FramesDetailPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="sessions/:id" element={<SessionsDetailPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="payments/transactions" element={<PaymentsTransactionsPage />} />
        <Route path="voucher" element={<VoucherPage />} />
        <Route path="whatsapp" element={<WhatsappPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
