import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copy } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** Campo clicavel que copia o valor. */
export default function CopyRow({ label, value, large, toastLabel }: { label: string; value: string; large?: boolean; toastLabel?: string }) {
  const [done, setDone] = useState(false);
  const onClick = async () => {
    await copy(value, toastLabel ?? `${label} copiado`);
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border bg-muted/50 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted"
      aria-label={`Copiar ${label}`}
    >
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn("truncate font-mono", large ? "mt-0.5 text-xl font-bold tracking-[0.25em]" : "text-sm")}>{value}</div>
      </div>
      <span className="shrink-0 text-muted-foreground transition-colors group-hover:text-foreground">
        {done ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </span>
    </button>
  );
}
