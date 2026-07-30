import { useEffect, useState } from "react";
import { VoucherManager, type VoucherDto } from "@/components/admin/voucher-manager";
import { get } from "@/lib/api";

// Ported from apps/cloud/app/admin/voucher/page.tsx — now fetches
// GET /api/admin/voucher/list instead of querying D1 directly.
export default function VoucherPage() {
  const [initial, setInitial] = useState<VoucherDto[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    get<{ payment: VoucherDto[]; discount: VoucherDto[] }>("/admin/voucher/list")
      .then((res) => {
        if (!cancelled) setInitial([...(res.payment ?? []), ...(res.discount ?? [])]);
      })
      .catch(() => {
        if (!cancelled) setInitial([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (initial === null) return null;
  return <VoucherManager initial={initial} />;
}
