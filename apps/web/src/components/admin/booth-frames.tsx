import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Library, Plus, Star, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, del, get, post, put } from "@/lib/api";
import { formatRupiah } from "@/lib/utils";
import { displayUrl } from "@/lib/storage/r2-client";

type BoothFrame = {
  frameId: string;
  price: number;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
  frame: {
    id: string;
    name: string;
    tier: string;
    isActive: boolean;
    seasonStart: string | null;
    seasonEnd: string | null;
    layoutOk?: boolean;
    previewUrl: string | null;
  };
};

type LibraryItem = { id: string; name: string; tier: string; isActive: boolean; previewUrl: string | null };

const MIN_PRICE = 1000;

function errMsg(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message || fallback : fallback;
}

// Kenapa frame tidak tampil di kiosk walau terpasang — dijelaskan per baris
// supaya admin tidak bingung "sudah dipasang kok tidak muncul".
function hiddenReason(bf: BoothFrame): string | null {
  if (!bf.frame.isActive) return "Diarsipkan di library";
  if (bf.frame.layoutOk === false) return "Layout lama, edit desain dulu";
  if (!bf.isActive) return "Disembunyikan di booth ini";
  const now = Date.now();
  if (bf.frame.seasonStart && new Date(bf.frame.seasonStart).getTime() > now) return "Belum masuk jadwal tampil";
  if (bf.frame.seasonEnd && new Date(bf.frame.seasonEnd).getTime() < now) return "Jadwal tampil sudah lewat";
  return null;
}

export function BoothFramesManager({
  boothId,
  boothName,
  defaultPrice,
}: {
  boothId: string;
  boothName: string;
  defaultPrice: number;
}) {
  const [items, setItems] = useState<BoothFrame[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await get<{ data: BoothFrame[] }>(`/booths/${boothId}/frames`);
      setItems(res.data);
    } catch (err) {
      toast.error(errMsg(err, "Gagal memuat frame booth"));
      setItems([]);
    }
  }, [boothId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(frameId: string, patch: Partial<Pick<BoothFrame, "price" | "isActive" | "isDefault">>, okMsg?: string) {
    setBusy(frameId);
    try {
      await put(`/booths/${boothId}/frames/${frameId}`, patch);
      if (okMsg) toast.success(okMsg);
      await load();
    } catch (err) {
      toast.error(errMsg(err, "Gagal menyimpan"));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function remove(bf: BoothFrame) {
    if (!confirm(`Lepas "${bf.frame.name}" dari ${boothName}? Desainnya tetap ada di library.`)) return;
    setBusy(bf.frameId);
    try {
      await del(`/booths/${boothId}/frames/${bf.frameId}`);
      toast.success("Frame dilepas dari booth");
      await load();
    } catch (err) {
      toast.error(errMsg(err, "Gagal melepas frame"));
    } finally {
      setBusy(null);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    if (!items) return;
    const next = [...items];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j]!, next[index]!];
    setItems(next);
    try {
      await post(`/booths/${boothId}/frames/reorder`, { frameIds: next.map((x) => x.frameId) });
    } catch (err) {
      toast.error(errMsg(err, "Gagal mengubah urutan"));
      await load();
    }
  }

  const visibleCount = useMemo(() => (items ?? []).filter((x) => !hiddenReason(x)).length, [items]);

  if (items === null) return <p className="text-sm text-muted-foreground">Memuat frame…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={() => setPickerOpen(true)}>
            <Library className="h-4 w-4" />
            Ambil dari library
          </Button>
          <Button asChild variant="brand">
            <Link to={`/admin/frames/new?booth=${boothId}`}>
              <Upload className="h-4 w-4" />
              Unggah frame baru
            </Link>
          </Button>
      </div>
      {items.length ? (
        <p className="text-sm text-muted-foreground">
          {visibleCount} dari {items.length} frame tampil di kiosk, urut sesuai daftar. Harga tersimpan otomatis
          setelah Enter atau pindah kolom.
        </p>
      ) : null}

      {items.length > 0 && visibleCount === 0 ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          Tidak ada frame yang tampil. Pelanggan tidak bisa memilih frame di kiosk.
        </div>
      ) : null}

      {items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 border-dashed py-12 text-center">
          <p className="text-sm font-medium text-brand-green-dark">Kiosk belum punya frame</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Unggah desain baru, atau ambil frame yang sudah ada di library. Harga diatur khusus untuk {boothName}.
          </p>
        </Card>
      ) : (
        <ul className="space-y-2" aria-label={`Frame di ${boothName}`}>
          <li aria-hidden className="hidden items-center gap-3 border border-transparent px-3 text-xs font-medium text-muted-foreground md:flex">
            <span className="w-[96px]">Urutan · Frame</span>
            <span className="min-w-[140px] flex-1" />
            <span className="w-[138px]">Harga di booth ini</span>
            <span className="flex items-center gap-1">
              <span className="w-[156px] px-1">Tampil di kiosk</span>
              <span className="w-9 text-center">Utama</span>
              <span className="w-[76px]" />
            </span>
          </li>
          {items.map((bf, i) => (
            <FrameRow
              key={bf.frameId}
              bf={bf}
              first={i === 0}
              last={i === items.length - 1}
              busy={busy === bf.frameId}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onPrice={(price) => save(bf.frameId, { price }, `Harga ${bf.frame.name} jadi ${formatRupiah(price)}`)}
              onActive={(isActive) => save(bf.frameId, { isActive })}
              onDefault={() => save(bf.frameId, { isDefault: !bf.isDefault })}
              onRemove={() => remove(bf)}
            />
          ))}
        </ul>
      )}

      <LibraryPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        boothId={boothId}
        boothName={boothName}
        defaultPrice={defaultPrice}
        attachedIds={new Set(items.map((x) => x.frameId))}
        onAttached={load}
      />
    </div>
  );
}

function FrameRow({
  bf,
  first,
  last,
  busy,
  onUp,
  onDown,
  onPrice,
  onActive,
  onDefault,
  onRemove,
}: {
  bf: BoothFrame;
  first: boolean;
  last: boolean;
  busy: boolean;
  onUp: () => void;
  onDown: () => void;
  onPrice: (p: number) => void;
  onActive: (v: boolean) => void;
  onDefault: () => void;
  onRemove: () => void;
}) {
  const [price, setPrice] = useState(String(bf.price));
  useEffect(() => setPrice(String(bf.price)), [bf.price]);
  const reason = hiddenReason(bf);
  const n = Number(price || "0");
  const invalid = !Number.isInteger(n) || n < MIN_PRICE;
  const dirty = n !== bf.price;

  function commit() {
    if (!dirty) return;
    if (invalid) {
      toast.error(`Harga minimal ${formatRupiah(MIN_PRICE)}`);
      setPrice(String(bf.price));
      return;
    }
    onPrice(n);
  }

  return (
    <li
      data-testid={`booth-frame-${bf.frameId}`}
      className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${reason ? "border-dashed bg-muted/30" : "bg-card"}`}
    >
      <div className="flex flex-col">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onUp} disabled={first || busy} aria-label="Naikkan urutan" title="Naikkan urutan">
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDown} disabled={last || busy} aria-label="Turunkan urutan" title="Turunkan urutan">
          <ArrowDown className="h-4 w-4" />
        </Button>
      </div>

      <div className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-white ${reason ? "opacity-50" : ""}`}>
        {bf.frame.previewUrl ? (
          <img src={displayUrl(bf.frame.previewUrl)} alt="" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Library className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>

      <div className="min-w-[140px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/admin/frames/${bf.frameId}`} className="font-medium text-brand-green-dark hover:underline">
            {bf.frame.name}
          </Link>
          {bf.isDefault ? <Badge variant="warn">Frame utama</Badge> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="capitalize">{bf.frame.tier}</span>
          {reason && bf.isActive ? <span className="font-medium text-amber-700"> · {reason}</span> : null}
        </p>
      </div>

      <div className="flex w-[138px] items-center gap-1.5">
        <span className="text-sm text-muted-foreground">Rp</span>
        <Input
          aria-label={`Harga ${bf.frame.name}`}
          className={`h-9 w-28 text-right tabular-nums ${invalid ? "border-destructive" : ""}`}
          type="text"
          inputMode="numeric"
          value={price ? Number(price).toLocaleString("id-ID") : ""}
          disabled={busy}
          onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 8))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setPrice(String(bf.price));
          }}
        />
      </div>

      <div className="flex items-center gap-1">
        <label className="flex w-[156px] items-center gap-2 px-1 text-xs">
          <Switch
            checked={bf.isActive}
            onCheckedChange={onActive}
            disabled={busy}
            aria-label={`Tampilkan ${bf.frame.name} di kiosk`}
          />
          <span className={bf.isActive ? "text-foreground" : "text-muted-foreground"}>
            {bf.isActive ? "Tampil" : "Disembunyikan"}
          </span>
        </label>
        <Button
          variant="ghost"
          size="icon"
          onClick={onDefault}
          disabled={busy}
          aria-label={bf.isDefault ? "Batalkan frame utama" : "Jadikan frame utama"}
          title={bf.isDefault ? "Batalkan frame utama" : "Jadikan frame utama (dipilih otomatis di kiosk)"}
        >
          <Star className={`h-4 w-4 ${bf.isDefault ? "fill-amber-400 text-amber-500" : ""}`} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Lepas ${bf.frame.name} dari booth`}
          title="Lepas dari booth ini. Desain tetap ada di library."
          className="w-[76px] text-destructive hover:text-destructive"
        >
          <X className="h-4 w-4" />
          Lepas
        </Button>
      </div>
    </li>
  );
}

function LibraryPicker({
  open,
  onOpenChange,
  boothId,
  boothName,
  defaultPrice,
  attachedIds,
  onAttached,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  boothId: string;
  boothName: string;
  defaultPrice: number;
  attachedIds: Set<string>;
  onAttached: () => Promise<void> | void;
}) {
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [price, setPrice] = useState(String(defaultPrice));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setPrice(String(defaultPrice));
    get<{ data: LibraryItem[] }>("/frames")
      .then((res) => setLibrary(res.data))
      .catch(() => setLibrary([]));
  }, [open, defaultPrice]);

  // Frame diarsipkan tidak ditawarkan: dipasang pun tidak akan tampil di kiosk.
  const available = (library ?? []).filter((f) => !attachedIds.has(f.id) && f.isActive);
  const n = Number(price || "0");
  const valid = selected && Number.isInteger(n) && n >= MIN_PRICE;

  async function attach() {
    if (!valid || !selected) return;
    setSaving(true);
    try {
      await put(`/booths/${boothId}/frames/${selected}`, { price: n, isActive: true });
      toast.success(`Frame dipasang di ${boothName} (${formatRupiah(n)})`);
      onOpenChange(false);
      await onAttached();
    } catch (err) {
      toast.error(errMsg(err, "Gagal memasang frame"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ambil frame dari library</DialogTitle>
          <DialogDescription>Pilih desain, lalu isi harganya khusus untuk {boothName}.</DialogDescription>
        </DialogHeader>

        {library === null ? (
          <p className="text-sm text-muted-foreground">Memuat…</p>
        ) : available.length === 0 ? (
          <div className="space-y-2 py-4 text-center text-sm text-muted-foreground">
            <p>Tidak ada frame lain di library (semua sudah terpasang, atau diarsipkan).</p>
            <Button asChild variant="link">
              <Link to={`/admin/frames/new?booth=${boothId}`}>
                <Plus className="h-4 w-4" /> Unggah frame baru
              </Link>
            </Button>
          </div>
        ) : (
          <div role="radiogroup" aria-label="Frame library" className="grid max-h-72 grid-cols-3 items-start gap-2 overflow-y-auto sm:grid-cols-4">
            {available.map((f) => (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected === f.id}
                onClick={() => setSelected(f.id)}
                className={`rounded-md border p-1.5 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selected === f.id ? "border-brand-green-dark ring-2 ring-brand-green-dark" : "hover:border-foreground/40"
                }`}
              >
                <div className="flex aspect-[2/3] items-center justify-center overflow-hidden rounded bg-white">
                  {f.previewUrl ? (
                    <img src={displayUrl(f.previewUrl)} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <Library className="h-5 w-5 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <p className="mt-1 truncate font-medium">{f.name}</p>
                <p className="text-[10px] capitalize text-muted-foreground">{f.tier}</p>
              </button>
            ))}
          </div>
        )}

        {available.length > 0 ? (
          <div className="grid gap-1.5">
            <label htmlFor="attach-price" className="text-sm font-medium">
              Harga di {boothName} (Rp)
            </label>
            <Input
              id="attach-price"
              type="text"
              inputMode="numeric"
              className="tabular-nums"
              value={price ? Number(price).toLocaleString("id-ID") : ""}
              onChange={(e) => setPrice(e.target.value.replace(/\D/g, "").slice(0, 8))}
            />
            <p className="text-xs text-muted-foreground">
              Terisi harga default booth ({formatRupiah(defaultPrice)}). Minimal {formatRupiah(MIN_PRICE)}.
            </p>
          </div>
        ) : null}

        <DialogFooter className="items-center">
          {available.length > 0 && !selected ? (
            <p className="mr-auto text-xs text-muted-foreground">Pilih satu frame dulu.</p>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Batal
          </Button>
          <Button variant="brand" onClick={attach} disabled={!valid || saving}>
            {saving ? "Memasang…" : "Pasang di booth"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
