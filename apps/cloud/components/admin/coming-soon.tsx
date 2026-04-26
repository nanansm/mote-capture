import { Card, CardContent } from "@/components/ui/card";
import { Sparkles } from "lucide-react";

export function ComingSoon({ title, sprint }: { title: string; sprint: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-yellow text-brand-green-dark">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-brand-green-dark">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Modul ini akan tersedia di {sprint}.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
