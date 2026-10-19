import { Tv } from "lucide-react";

export default function Logo({ subtitle = "IPTV Panel" }: { subtitle?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="gradient-brand flex h-10 w-10 items-center justify-center rounded-xl shadow-lg shadow-primary/30">
        <Tv className="h-5 w-5 text-white" />
      </div>
      <div className="leading-tight">
        <div className="text-lg font-bold tracking-tight">
          R<span className="gradient-text">Tec</span>
        </div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
    </div>
  );
}
