import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, ExternalLink, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Service = "xendit" | "ipaymu";
type Result = { success: boolean; message: string };

function TestButton({ service, label }: { service: Service; label: string }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ service }),
      });
      const body = (await res.json()) as Result;
      setResult(body);
      if (body.success) toast.success(body.message);
      else toast.error(body.message);
    } catch {
      setResult({ success: false, message: "Gagal menghubungi server" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button onClick={handleTest} variant="outline" size="sm" disabled={testing}>
        {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {label}
      </Button>
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
    </div>
  );
}

function Url({ path }: { path: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-domain";
  return (
    <code className="block break-all rounded-md border border-input bg-muted/40 p-3 font-mono text-xs">
      {origin}
      {path}
    </code>
  );
}

export function PaymentsSettings() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Provider per Booth
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            Provider yang dipakai ditentukan di tiap booth:{" "}
            <Link to="/admin/booths" className="font-medium underline">
              Booths → Edit → Payment Provider
            </Link>
            . Perubahan berlaku mulai sesi berikutnya, tanpa deploy.
          </p>
          <p className="text-xs text-muted-foreground">
            Pindah provider hanya setelah tombol Test provider tujuan berhasil. Kalau kredensial
            provider terpilih kosong, booth jatuh ke mock mode (QR palsu) dan tidak bisa dibayar.
          </p>
          <div className="flex flex-wrap gap-4">
            <TestButton service="xendit" label="Test Xendit" />
            <TestButton service="ipaymu" label="Test iPaymu" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1">
            <p className="font-medium">Xendit</p>
            <p>
              Daftarkan di Xendit Dashboard → Settings → Webhooks, event{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">qr.payment</code>:
            </p>
            <Url path="/api/webhook/xendit" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">iPaymu</p>
            <p>
              Tidak perlu didaftarkan. Alamat ini dikirim otomatis ke iPaymu setiap QR dibuat, dan
              status bayar selalu dicek ulang langsung ke API iPaymu.
            </p>
            <Url path="/api/webhook/ipaymu" />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button asChild variant="ghost" size="sm">
              <a href="https://dashboard.xendit.co" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Xendit Dashboard
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href="https://my.ipaymu.com" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                iPaymu Dashboard
              </a>
            </Button>
          </div>
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
