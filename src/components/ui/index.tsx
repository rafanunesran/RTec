import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost" | "destructive" | "gradient" | "secondary";
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm";
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-all duration-200 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        {
          default: "bg-foreground text-background hover:bg-foreground/90",
          gradient: "bg-brand text-primary-foreground shadow-glow hover:brightness-110",
          outline: "border border-border bg-card/50 hover:border-muted-foreground/30 hover:bg-accent",
          secondary: "bg-secondary text-foreground hover:bg-secondary/80",
          ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
          destructive: "bg-destructive text-white hover:bg-destructive/90",
        }[variant],
        { default: "h-10 px-4", sm: "h-8 px-3 text-xs", lg: "h-12 px-6 text-base", icon: "h-10 w-10", "icon-sm": "h-8 w-8" }[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";

const field =
  "w-full rounded-lg border border-input bg-card/60 text-sm transition-colors placeholder:text-muted-foreground/70 hover:border-muted-foreground/30 focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(field, "flex h-10 px-3 py-2 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground", className)} {...props} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(field, "flex min-h-[90px] px-3 py-2 font-mono", className)} {...props} />,
);
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(field, "flex h-10 cursor-pointer px-3 [&>option]:bg-card", className)} {...props} />,
);
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium leading-none", className)} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border bg-card text-card-foreground shadow-card", className)} {...props} />;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "success" | "danger" | "warning" | "info" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        {
          default: "border-primary/30 bg-primary/15 text-primary",
          success: "border-success/30 bg-success/15 text-success",
          danger: "border-destructive/30 bg-destructive/15 text-destructive",
          warning: "border-warning/30 bg-warning/15 text-warning",
          info: "border-brand2/30 bg-brand2/15 text-brand2",
          muted: "border-transparent bg-secondary text-muted-foreground",
        }[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-brand" : "bg-secondary ring-1 ring-border",
      )}
    >
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  icon,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center overflow-y-auto bg-background/70 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative max-h-[92dvh] w-full animate-rise-in overflow-y-auto rounded-t-3xl border bg-card p-6 shadow-2xl sm:animate-pop-in sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
        {icon && <div className="mb-3">{icon}</div>}
        <h2 className="pr-8 text-lg font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-14 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-muted text-muted-foreground ring-1 ring-border">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

const tones = {
  primary: "text-primary bg-primary/10 ring-primary/25",
  success: "text-success bg-success/10 ring-success/25",
  destructive: "text-destructive bg-destructive/10 ring-destructive/25",
  info: "text-brand2 bg-brand2/10 ring-brand2/25",
  warning: "text-warning bg-warning/10 ring-warning/25",
};

/** Icone com fundo colorido, usado em cards de metricas e listas. */
export function IconTile({ icon, tone = "primary", className }: { icon: React.ReactNode; tone?: keyof typeof tones; className?: string }) {
  return <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 [&_svg]:h-4 [&_svg]:w-4", tones[tone], className)}>{icon}</div>;
}

export function StatCard({ label, value, icon, tone = "primary" }: { label: string; value?: number; icon: React.ReactNode; tone?: keyof typeof tones }) {
  return (
    <Card className="p-5 transition-colors hover:border-muted-foreground/25">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <IconTile icon={icon} tone={tone} />
      </div>
      {value === undefined ? <Skeleton className="mt-4 h-9 w-16" /> : <div className="mt-4 text-3xl font-bold tracking-tight tabular-nums">{value}</div>}
    </Card>
  );
}

/** Botao de opcao (tipo de lista, modo de reproducao). */
export function OptionCard({ active, onClick, children, className }: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-xl border p-3 text-left transition-all",
        active ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border hover:border-muted-foreground/40 hover:bg-muted/40",
        className,
      )}
    >
      {children}
    </button>
  );
}
