// Generic scaffold placeholder used by every route this task (T4.1) doesn't
// wire up yet. Renders just the page title + a TODO note — no data fetching,
// no ported list/form component. The real page bodies (using the already-
// ported components in src/components/admin and src/components/kiosk) are
// task berikutnya.
export function PlaceholderPage({ title, note }: { title: string; note?: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-xl font-semibold text-brand-green-dark">{title}</h2>
      <p className="text-sm text-muted-foreground">
        {note ?? "TODO diisi task berikutnya."}
      </p>
    </div>
  );
}
