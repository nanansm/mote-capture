import { useState } from "react";
import { Copy, Loader2, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  sessionId: string;
  status: string;
  shareUrl: string;
  initialPhone: string | null;
  initialEmail: string | null;
  /** Called after a notify/refund action succeeds, so the parent page can
   * refetch the session detail (payment logs, status) it owns. */
  onUpdated?: () => void;
};

export function SessionActions({
  sessionId,
  status,
  shareUrl,
  initialPhone,
  initialEmail,
  onUpdated,
}: Props) {
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [email, setEmail] = useState(initialEmail ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<null | "notify" | "resend" | "refund" | "copy">(null);

  async function handleNotify() {
    setBusy("notify");
    try {
      const res = await fetch(`/api/session/${sessionId}/notify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, email }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Gagal mengirim notifikasi");
        return;
      }
      const wa = body.whatsapp ? (body.whatsapp.mockMode ? "WA: mock" : body.whatsapp.ok ? "WA: terkirim" : `WA: ${body.whatsapp.message ?? "gagal"}`) : null;
      const em = body.email ? (body.email.mockMode ? "Email: mock" : body.email.ok ? "Email: terkirim" : `Email: ${body.email.message ?? "gagal"}`) : null;
      toast.success([wa, em].filter(Boolean).join(" · ") || "Notifikasi diproses");
      onUpdated?.();
    } finally {
      setBusy(null);
    }
  }

  async function handleResend() {
    setBusy("resend");
    try {
      const res = await fetch(`/api/session/${sessionId}/resend`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Gagal kirim ulang");
        return;
      }
      toast.success("Notifikasi dikirim ulang");
    } finally {
      setBusy(null);
    }
  }

  async function handleRefund() {
    if (!reason.trim()) {
      toast.error("Alasan refund wajib diisi");
      return;
    }
    if (!confirm("Yakin refund manual? Status session akan diubah jadi 'failed'.")) return;
    setBusy("refund");
    try {
      const res = await fetch(`/api/session/${sessionId}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Gagal refund");
        return;
      }
      toast.success("Refund tercatat");
      setReason("");
      onUpdated?.();
    } finally {
      setBusy(null);
    }
  }

  function copyShareUrl() {
    setBusy("copy");
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => toast.success("Share URL disalin"))
      .catch(() => toast.error("Gagal menyalin"))
      .finally(() => setBusy(null));
  }

  const canRefund = status === "paid" || status === "capturing" || status === "processing";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Kirim Foto ke Customer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="phone">Nomor WhatsApp</Label>
              <Input
                id="phone"
                placeholder="0812xxxxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="customer@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleNotify} variant="brand" size="sm" disabled={busy === "notify"}>
              {busy === "notify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Kirim
            </Button>
            <Button onClick={handleResend} variant="outline" size="sm" disabled={busy === "resend"}>
              {busy === "resend" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Kirim Ulang
            </Button>
            <Button onClick={copyShareUrl} variant="ghost" size="sm" disabled={busy === "copy"}>
              <Copy className="h-4 w-4" />
              Salin Share URL
            </Button>
          </div>
        </CardContent>
      </Card>

      {canRefund ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" />
              Manual Refund
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Alasan refund (wajib)"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              onClick={handleRefund}
              variant="destructive"
              size="sm"
              disabled={busy === "refund" || !reason.trim()}
            >
              {busy === "refund" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Tandai Refund
            </Button>
            <p className="text-xs text-muted-foreground">
              Refund di Sprint 2 hanya catat status di sistem. Refund nominal real ke customer tetap manual lewat dashboard Xendit.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
