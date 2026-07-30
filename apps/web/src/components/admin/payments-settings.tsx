import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  defaultProvider: string;
};

export function PaymentsSettings({ defaultProvider }: Props) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ service: "xendit" }),
      });
      const body = await res.json();
      setResult({ success: body.success, message: body.message });
      if (body.success) toast.success(body.message);
      else toast.error(body.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Provider Default
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm">
              Provider aktif:{" "}
              <span className="font-semibold capitalize text-brand-green-dark">
                {defaultProvider}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Sprint 2 hanya support Xendit (QRIS Dynamic). iPaymu menyusul di sprint berikutnya.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleTest} variant="outline" size="sm" disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Test Credentials
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href="https://dashboard.xendit.co" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Buka Xendit Dashboard
              </a>
            </Button>
          </div>

          {result ? (
            <div className="flex items-start gap-2 rounded-md border border-input bg-muted/40 p-3 text-sm">
              {result.success ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-brand-green-light" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
              )}
              <span>{result.message}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Daftarkan callback URL di Xendit Dashboard untuk event{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">qr.payment</code>:
          </p>
          <code className="block break-all rounded-md border border-input bg-muted/40 p-3 font-mono text-xs">
            {typeof window !== "undefined" ? window.location.origin : "https://your-domain"}/api/webhook/xendit
          </code>
          <p className="text-xs text-muted-foreground">
            Header verifikasi:{" "}
            <code className="rounded bg-muted px-1 font-mono">x-callback-token</code>{" "}
            harus match <code className="rounded bg-muted px-1 font-mono">XENDIT_WEBHOOK_TOKEN</code> di env.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit Trail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Lihat riwayat semua event payment (qr_created, paid, refund, dll).</p>
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/payments/transactions">Lihat Payment Logs →</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
