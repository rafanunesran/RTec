import { Copy } from "lucide-react";
import { copy } from "@/lib/utils";
import { Button, Input } from "@/components/ui";

export default function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button variant="outline" size="icon" onClick={() => copy(value)} title="Copiar">
          <Copy />
        </Button>
      </div>
    </div>
  );
}
