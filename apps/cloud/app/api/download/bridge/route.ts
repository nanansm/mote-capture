import { NextResponse } from "next/server";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createR2Client } from "@/lib/storage/r2";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// Stable key — overwrite this object in R2 on each new release and the public
// download URL stays the same. Booth PCs hit /download (or this route directly)
// to install the bridge without copying the .exe by hand.
const INSTALLER_KEY = "downloads/Mote-Capture-Bridge-Setup.exe";
const DOWNLOAD_FILENAME = "Mote-Capture-Bridge-Setup.exe";

export async function GET() {
  const client = createR2Client();
  if (!client || !env.R2_BUCKET_NAME) {
    return new Response("Storage belum dikonfigurasi.", { status: 503 });
  }
  try {
    // Presigned GET to the *.r2.cloudflarestorage.com endpoint (reachable; not
    // MITM-blocked like *.r2.dev). Force an attachment download with a clean
    // filename so the browser saves the .exe instead of trying to render it.
    const cmd = new GetObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: INSTALLER_KEY,
      ResponseContentType: "application/octet-stream",
      ResponseContentDisposition: `attachment; filename="${DOWNLOAD_FILENAME}"`,
    });
    const url = await getSignedUrl(client, cmd, { expiresIn: 3600 });
    return NextResponse.redirect(url, 302);
  } catch (err) {
    logger.error("bridge_download_error", {
      err: err instanceof Error ? err.message : String(err),
    });
    return new Response("Installer belum tersedia.", { status: 404 });
  }
}
