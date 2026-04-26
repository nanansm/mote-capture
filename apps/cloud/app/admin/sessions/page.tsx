import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { SessionsList } from "@/components/admin/sessions-list";

export const dynamic = "force-dynamic";

export default async function SessionsPage() {
  const [sessionRows, boothRows] = await Promise.all([
    db
      .select({
        id: schema.sessions.id,
        boothId: schema.sessions.boothId,
        status: schema.sessions.status,
        amount: schema.sessions.amount,
        customerEmail: schema.sessions.customerEmail,
        customerPhone: schema.sessions.customerPhone,
        createdAt: schema.sessions.createdAt,
        boothName: schema.booths.name,
      })
      .from(schema.sessions)
      .leftJoin(schema.booths, eq(schema.booths.id, schema.sessions.boothId))
      .orderBy(desc(schema.sessions.createdAt))
      .limit(500),
    db.select({ id: schema.booths.id, name: schema.booths.name }).from(schema.booths),
  ]);

  const rows = sessionRows.map((r) => ({
    id: r.id,
    boothId: r.boothId,
    boothName: r.boothName ?? r.boothId,
    status: r.status as Parameters<typeof SessionsList>[0]["rows"][number]["status"],
    amount: r.amount,
    customerEmail: r.customerEmail,
    customerPhone: r.customerPhone,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-brand-green-dark">Sessions</h2>
        <p className="text-sm text-muted-foreground">
          500 session terbaru di seluruh booth.
        </p>
      </div>
      <SessionsList rows={rows} booths={boothRows} />
    </div>
  );
}
