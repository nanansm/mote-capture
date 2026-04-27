import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// DEV-ONLY: return the most recent session for a booth so the CLI mock-pay
// helper can resolve the latest sessionId without copy-pasting from logs.
// Returns 403 when NODE_ENV=production.
type Ctx = { params: Promise<{ boothId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Not available in production" },
      { status: 403 },
    );
  }

  const { boothId } = await params;

  const [session] = await db
    .select({
      id: schema.sessions.id,
      boothId: schema.sessions.boothId,
      status: schema.sessions.status,
      amount: schema.sessions.amount,
      createdAt: schema.sessions.createdAt,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.boothId, boothId))
    .orderBy(desc(schema.sessions.createdAt))
    .limit(1);

  if (!session) {
    return NextResponse.json({ error: "No session found" }, { status: 404 });
  }

  return NextResponse.json(session);
}
