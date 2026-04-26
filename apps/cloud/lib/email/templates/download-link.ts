export type DownloadLinkVars = {
  link: string;
  boothName: string;
  expiryDate: string;
};

export function downloadLinkHtml(v: DownloadLinkVars): string {
  return `<!doctype html>
<html lang="id">
  <body style="margin:0;padding:0;background:#F5F0E8;font-family:'Plus Jakarta Sans',Arial,sans-serif;color:#1A3A2A;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F5F0E8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(26,58,42,0.08);">
            <tr>
              <td style="padding:32px 32px 16px 32px;text-align:center;">
                <p style="margin:0;font-size:14px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#86A398;">Mote Capture</p>
                <h1 style="margin:12px 0 0 0;font-size:28px;line-height:1.2;color:#1A3A2A;">Foto Kamu Sudah Siap! 📸</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;font-size:16px;line-height:1.5;color:#1A3A2A;">
                <p style="margin:0 0 16px 0;">Halo!</p>
                <p style="margin:0 0 16px 0;">Terima kasih sudah berfoto di <strong>${escape(v.boothName)}</strong>. Foto kamu sudah siap di-download lewat tombol di bawah.</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:8px 32px 32px 32px;">
                <a href="${escape(v.link)}" style="display:inline-block;background:#F5E642;color:#1A3A2A;padding:14px 32px;border-radius:9999px;font-weight:700;text-decoration:none;font-size:16px;">Download Foto</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px 32px;font-size:14px;color:#5A6E63;text-align:center;">
                <p style="margin:0 0 8px 0;">Atau buka link ini:</p>
                <p style="margin:0 0 16px 0;word-break:break-all;"><a href="${escape(v.link)}" style="color:#1A3A2A;">${escape(v.link)}</a></p>
                <p style="margin:0;">Link berlaku sampai <strong>${escape(v.expiryDate)}</strong>.</p>
              </td>
            </tr>
            <tr>
              <td style="background:#1A3A2A;color:#F5E642;padding:24px;text-align:center;font-size:13px;">
                <p style="margin:0;">— Maja Photobooth × Mote Kreatif</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function downloadLinkText(v: DownloadLinkVars): string {
  return [
    "Foto kamu sudah siap! 📸",
    "",
    `Terima kasih sudah berfoto di ${v.boothName}.`,
    "",
    "Download di sini:",
    v.link,
    "",
    `Link berlaku sampai ${v.expiryDate}.`,
    "",
    "— Maja Photobooth × Mote Kreatif",
  ].join("\n");
}

function escape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
