// Client-safe template renderer, ported verbatim from
// apps/cloud/lib/settings/template-client.ts (the server-only store.ts there
// pulls in drizzle and was NOT ported).
export function renderTemplate(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = vars[key];
    return v === undefined ? `{${key}}` : v;
  });
}
