"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Booth } from "@capture/shared";
import { PAYMENT_PROVIDERS } from "@capture/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { boothInputSchema } from "@/lib/validations/booth";

type Mode = "create" | "edit";

export function BoothForm({
  mode,
  initial,
}: {
  mode: Mode;
  initial?: Booth;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [defaultPrice, setDefaultPrice] = useState<number>(
    initial?.defaultPrice ?? 30000,
  );
  const [paymentProvider, setPaymentProvider] = useState<"ipaymu" | "xendit">(
    (initial?.paymentProvider as "ipaymu" | "xendit") ?? "ipaymu",
  );
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [bridgeToken, setBridgeToken] = useState(initial?.bridgeToken ?? "(otomatis dibuat saat simpan)");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const payload = {
      name: name.trim(),
      location: location.trim() || null,
      defaultPrice: Number(defaultPrice),
      paymentProvider,
      isActive,
    };
    const parsed = boothInputSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Validasi gagal");
      return;
    }

    setSubmitting(true);
    try {
      const url = mode === "create" ? "/api/booths" : `/api/booths/${initial!.id}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Gagal menyimpan booth");
        return;
      }
      toast.success(mode === "create" ? "Booth berhasil dibuat" : "Booth diperbarui");
      router.push("/admin/booths");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegenerate() {
    if (!initial) return;
    if (!confirm("Generate ulang bridge token? Bridge yang lama akan kehilangan akses.")) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/booths/${initial.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ regenerateBridgeToken: true }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? "Gagal regenerate token");
        return;
      }
      setBridgeToken(body.data.bridgeToken);
      toast.success("Bridge token diperbarui");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-2">
            <Label htmlFor="name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Booth Maja Mall A"
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="location">Location</Label>
            <Input
              id="location"
              value={location ?? ""}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Jakarta Selatan"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="defaultPrice">
                Default Price (Rp) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="defaultPrice"
                type="number"
                min={1000}
                step={1000}
                value={defaultPrice}
                onChange={(e) => setDefaultPrice(Number(e.target.value))}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="paymentProvider">
                Payment Provider <span className="text-destructive">*</span>
              </Label>
              <Select
                value={paymentProvider}
                onValueChange={(v) => setPaymentProvider(v as "ipaymu" | "xendit")}
              >
                <SelectTrigger id="paymentProvider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-input p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">
                Booth yang aktif bisa menerima sesi.
              </p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="bridgeToken">Bridge Token</Label>
            <div className="flex gap-2">
              <Input
                id="bridgeToken"
                value={bridgeToken}
                readOnly
                className="font-mono text-xs"
              />
              {mode === "edit" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRegenerate}
                  disabled={submitting}
                >
                  <RefreshCw className="h-4 w-4" />
                  Regenerate
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Token ini dipakai bridge Electron untuk autentikasi. Jaga kerahasiaannya.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/booths")}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" variant="brand" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}
