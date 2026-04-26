"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, Mail, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export type EmailSettings = {
  enabled: boolean;
  from_name: string;
  subject?: string;
};

export type GeneralSettings = {
  booth_alert_offline_minutes: number;
};

export function SettingsPanel({
  initialEmail,
  initialGeneral,
}: {
  initialEmail: EmailSettings;
  initialGeneral: GeneralSettings;
}) {
  const [email, setEmail] = useState<EmailSettings>(initialEmail);
  const [general, setGeneral] = useState<GeneralSettings>(initialGeneral);
  const [saving, setSaving] = useState<"email" | "general" | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  async function saveEmail() {
    setSaving("email");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "email", value: email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Gagal menyimpan");
        return;
      }
      toast.success("Settings email tersimpan");
    } finally {
      setSaving(null);
    }
  }

  async function saveGeneral() {
    setSaving("general");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "general", value: general }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Gagal menyimpan");
        return;
      }
      toast.success("Settings umum tersimpan");
    } finally {
      setSaving(null);
    }
  }

  async function testEmail() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ service: "email" }),
      });
      const body = await res.json();
      setTestResult({ success: body.success, message: body.message });
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
            <Mail className="h-5 w-5" />
            Email Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-md border border-input p-3">
            <div>
              <p className="text-sm font-medium">Aktifkan kirim email</p>
              <p className="text-xs text-muted-foreground">
                Saat sesi selesai dan customer mengisi email, link foto otomatis dikirim.
              </p>
            </div>
            <Switch
              checked={email.enabled}
              onCheckedChange={(v) => setEmail({ ...email, enabled: v })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="from_name">Nama Pengirim</Label>
              <Input
                id="from_name"
                value={email.from_name}
                onChange={(e) => setEmail({ ...email, from_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="subject">Subject Default</Label>
              <Input
                id="subject"
                value={email.subject ?? ""}
                onChange={(e) => setEmail({ ...email, subject: e.target.value })}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={saveEmail} variant="brand" size="sm" disabled={saving === "email"}>
              {saving === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Simpan
            </Button>
            <Button onClick={testEmail} variant="outline" size="sm" disabled={testing}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Kirim Email Test
            </Button>
          </div>

          {testResult ? (
            <div className="flex items-start gap-2 rounded-md border border-input bg-muted/40 p-3 text-sm">
              {testResult.success ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-brand-green-light" />
              ) : (
                <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
              )}
              <span>{testResult.message}</span>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            SMTP host/user/password di-set dari env (<code className="font-mono">EMAIL_HOST</code>,{" "}
            <code className="font-mono">EMAIL_USER</code>, <code className="font-mono">EMAIL_PASSWORD</code>).
            Gunakan Gmail App Password.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="offline">Booth dianggap offline setelah (menit)</Label>
            <Input
              id="offline"
              type="number"
              min={1}
              value={general.booth_alert_offline_minutes}
              onChange={(e) =>
                setGeneral({
                  ...general,
                  booth_alert_offline_minutes: Number(e.target.value) || 5,
                })
              }
            />
            <p className="text-xs text-muted-foreground">
              Bridge mengirim heartbeat tiap 30 detik. Threshold ini dipakai untuk badge offline.
            </p>
          </div>
          <Button
            onClick={saveGeneral}
            variant="brand"
            size="sm"
            disabled={saving === "general"}
          >
            {saving === "general" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Simpan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
