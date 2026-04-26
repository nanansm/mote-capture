// Returns the booth bound to a given bridge token. Used by the Electron bridge
// at boot to auto-detect its boothId so the operator only has to paste a token.
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Bridge token diperlukan" }, { status: 401 });
  }
  const [booth] = await db
    .select({ id: schema.booths.id, name: schema.booths.name })
    .from(schema.booths)
    .where(eq(schema.booths.bridgeToken, token))
    .limit(1);
  if (!booth) {
    return NextResponse.json({ error: "Token tidak dikenal" }, { status: 404 });
  }
  return NextResponse.json({ data: { boothId: booth.id, name: booth.name } });
}
