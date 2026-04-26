"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, MessageSquare, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { renderTemplate } from "@/lib/settings/template-client";

type WaSettings = { enabled: boolean; template: string };

const PREVIEW_VARS = {
  link: "https://capture.motekreatif.com/share/abc123def456",
  nama_booth: "Booth Maja Mall A",
  tanggal: "26 April 2026",
};

export function WhatsappSettings({
  initial,
  instanceName,
}: {
  initial: WaSettings;
  instanceName: string;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [template, setTemplate] = useState(initial.template);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "whatsapp", value: { enabled, template } }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Gagal menyimpan");
        return;
      }
      toast.success("Settings WhatsApp tersimpan");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ service: "whatsapp" }),
      });
      const body = await res.json();
      setTestResult({ success: body.success, message: body.message });
      if (body.success) toast.success(body.message);
      else toast.error(body.message);
    } finally {
      setTesting(false);
    }
  }

  const preview = renderTemplate(template, PREVIEW_VARS);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Status Koneksi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            {testResult ? (
              testResult.success ? (
                <CheckCircle2 className="h-4 w-4 text-brand-green-light" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )
            ) : (
              <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" />
            )}
            <span>
              {testResult
                ? testResult.message
                : "Klik “Test Connection” untuk cek status Evolution API"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            Instance: <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{instanceName}</code>
          </div>
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Test Connection
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pengaturan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-md border border-input p-3">
            <div>
              <p className="text-sm font-medium">Aktifkan kirim WhatsApp</p>
              <p className="text-xs text-muted-foreground">
                Saat sesi selesai, link foto otomatis dikirim ke nomor pelanggan.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="template">Template Pesan</Label>
            <Textarea
              id="template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={10}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Variabel tersedia:{" "}
              <code className="rounded bg-muted px-1 font-mono">{"{link}"}</code>{" "}
              <code className="rounded bg-muted px-1 font-mono">{"{nama_booth}"}</code>{" "}
              <code className="rounded bg-muted px-1 font-mono">{"{tanggal}"}</code>
            </p>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Preview
            </Label>
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-dashed border-brand-green-dark/20 bg-brand-cream/40 p-4 text-sm">
              {preview}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} variant="brand" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Simpan
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
