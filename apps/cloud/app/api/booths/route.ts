import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentSession } from "@/lib/auth";
import { boothInputSchema } from "@/lib/validations/booth";
import { generateBoothId, generateBridgeToken } from "@/lib/id";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db
    .select()
    .from(schema.booths)
    .orderBy(desc(schema.booths.createdAt));

  return NextResponse.json({ data: rows });
}

export async function POST(req: Request) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }
  const parsed = boothInputSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validasi gagal" },
      { status: 400 },
    );
  }

  const id = generateBoothId();
  const bridgeToken = generateBridgeToken();
  const data = parsed.data;

  const [created] = await db
    .insert(schema.booths)
    .values({
      id,
      name: data.name,
      location: data.location,
      defaultPrice: data.defaultPrice,
      paymentProvider: data.paymentProvider,
      bridgeToken,
      isActive: data.isActive,
    })
    .returning();

  logger.info("booth_created", { id });
  return NextResponse.json({ data: created }, { status: 201 });
}
