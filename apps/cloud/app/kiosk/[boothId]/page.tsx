import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { KioskShell } from "./components/kiosk-shell";

export const dynamic = "force-dynamic";

export default async function KioskPage({
  params,
}: {
  params: Promise<{ boothId: string }>;
}) {
  const { boothId } = await params;
  const [booth] = await db
    .select()
    .from(schema.booths)
    .where(eq(schema.booths.id, boothId))
    .limit(1);
  if (!booth) notFound();

  const useMockBridge =
    ((booth.metadata as Record<string, unknown> | null)?.use_mock_bridge as
      | boolean
      | undefined) ?? true;

  return (
    <KioskShell
      boothId={booth.id}
      boothName={booth.name}
      defaultPrice={booth.defaultPrice}
      useMockBridge={useMockBridge}
      isActive={booth.isActive}
    />
  );
}
