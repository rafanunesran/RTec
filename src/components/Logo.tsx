import { Tv } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Logo({ subtitle, className }: { subtitle?: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand shadow-glow">
        <Tv className="h-[18px] w-[18px] text-white" strokeWidth={2.5} />
      </div>
      <div className="min-w-0 leading-tight">
        <div className="text-lg font-extrabold tracking-tight">
          R<span className="text-brand">Tec</span>
        </div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  );
}
