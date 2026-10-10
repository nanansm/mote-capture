import { Link } from "react-router-dom";
import { PaymentAccountsManager } from "@/components/admin/payment-accounts";
import { Button } from "@/components/ui/button";

// Akun pembayaran (Xendit/iPaymu) dibuat di sini lalu dipilih per booth.
// Tidak ada kredensial global.
export default function PaymentsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold text-brand-green-dark">Akun Pembayaran</h2>
          <p className="text-sm text-muted-foreground">
            Tiap booth memakai satu akun Xendit atau iPaymu. Uang masuk ke akun yang dipilih booth itu.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/payments/transactions">Payment Logs →</Link>
        </Button>
      </div>
      <PaymentAccountsManager />
    </div>
  );
}
