import { useState } from "react";
import { KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { patch } from "@/lib/api";

// Credentials the admin can rotate without a deploy. The server never sends
// the real values back — each field arrives masked plus a `source` saying
// whether the live value comes from this panel ("ui"), the Worker secrets the
// app was deployed with ("server"), or nowhere yet ("none").
//
// Consequence for the UX: an empty input means "leave it alone", never "clear
// it". Clearing is a separate, explicit button, because a stray Save with a
// blank field would otherwise silently knock a live payment key out.
export type CredentialField = {
  key: string;
  label: string;
  hint?: string;
  // Non-secret values (URL, instance name) come back in full and are editable
  // as normal text; secrets only ever show a mask.
  plain?: boolean;
};

export type CredentialState = Record<string, { masked: string; source: "ui" | "server" | "none" }>;

export type CredentialsMeta = {
  encryptionConfigured: boolean;
  decryptFailed: boolean;
};

function SourceBadge({ source }: { source: "ui" | "server" | "none" }) {
  if (source === "ui") {
    return (
      <span className="rounded-full bg-brand-green-dark/10 px-2 py-0.5 text-xs font-medium text-brand-green-dark">
        dari panel ini
      </span>
    );
  }
  if (source === "server") {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        dari secret server
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      belum diisi
    </span>
  );
}

export function CredentialsPanel({
  title,
  description,
  fields,
  initial,
  meta,
  onSaved,
}: {
  title: string;
  description: string;
  fields: CredentialField[];
  initial: CredentialState;
  meta: CredentialsMeta;
  onSaved?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<CredentialState>(initial);

  const dirty = Object.values(values).some((v) => v.trim().length > 0);

  async function save(clear?: string[]) {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const field of fields) {
        const v = values[field.key];
        if (v && v.trim().length > 0) payload[field.key] = v.trim();
      }
      if (clear?.length) payload.clear = clear;

      const res = await patch<{ data: { changed: string[] } }>("/settings/credentials", payload);
      if (res.data.changed.length === 0) {
        toast.info("Tidak ada perubahan — isi field yang mau diganti dulu.");
        return;
      }
      // Reflect the new source locally so the badge updates without a reload;
      // the mask itself is only known server-side, so re-fetch for exact text.
      setState((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(payload)) {
          if (key === "clear") continue;
          next[key] = { masked: "••••••••", source: "ui" };
        }
        for (const key of clear ?? []) {
          next[key] = { masked: "", source: "none" };
        }
        return next;
      });
      setValues({});
      toast.success("Kredensial tersimpan. Berlaku mulai transaksi berikutnya.");
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan kredensial");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{description}</p>

        {!meta.encryptionConfigured ? (
          <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Penyimpanan kredensial belum aktif.</p>
              <p>
                Jalankan sekali di mesin dev:{" "}
                <code className="rounded bg-amber-100 px-1">wrangler secret put SETTINGS_ENC_KEY</code>{" "}
                (isi dengan hasil <code className="rounded bg-amber-100 px-1">openssl rand -base64 32</code>).
                Sampai itu diset, kredensial hanya bisa lewat secret server.
              </p>
            </div>
          </div>
        ) : null}

        {meta.decryptFailed ? (
          <div className="flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Ada kredensial tersimpan yang tidak bisa dibuka.</p>
              <p>
                SETTINGS_ENC_KEY berubah atau hilang, jadi nilai lama tidak terpakai. Isi ulang
                field di bawah untuk memperbaiki.
              </p>
            </div>
          </div>
        ) : null}

        {fields.map((field) => {
          const current = state[field.key];
          return (
            <div key={field.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={field.key} className="text-sm font-medium">
                  {field.label}
                </label>
                <SourceBadge source={current?.source ?? "none"} />
              </div>
              <input
                id={field.key}
                type={field.plain ? "text" : "password"}
                autoComplete="off"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                placeholder={current?.masked || "belum diisi"}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
              />
              {field.hint ? (
                <p className="text-xs text-muted-foreground">{field.hint}</p>
              ) : null}
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Simpan
          </Button>
          <Button
            variant="outline"
            disabled={saving}
            onClick={() => {
              const installed = fields.filter((f) => state[f.key]?.source === "ui").map((f) => f.key);
              if (installed.length === 0) {
                toast.info("Tidak ada kredensial dari panel ini yang bisa dihapus.");
                return;
              }
              void save(installed);
            }}
          >
            Hapus & pakai secret server
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Field kosong = nilai lama dipertahankan. Tidak perlu deploy ulang — perubahan berlaku
          untuk transaksi berikutnya.
        </p>
      </CardContent>
    </Card>
  );
}
