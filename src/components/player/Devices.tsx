import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Laptop,
  Link2,
  Loader2,
  Monitor,
  Plus,
  Share2,
  Smartphone,
  Trash2,
  Tv,
} from "lucide-react";
import { toast } from "sonner";
import { api, type PlayerDevice, type PlayerLink } from "@/lib/api";
import { cn, formatDate } from "@/lib/utils";
import CopyRow from "@/components/CopyRow";
import { Button, Dialog, Field, Input } from "@/components/ui";

const INACTIVE_DAYS = 30;

/** "agora", "há 5 min", "há 3 h", "há 12 dias". */
function ago(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 2) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "há 1 dia" : `há ${d} dias`;
}

/** Quanto falta: "3 h", "2 dias e 4 h". */
function left(iso: string) {
  const min = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  const r = h % 24;
  return `${d} ${d === 1 ? "dia" : "dias"}${r ? ` e ${r} h` : ""}`;
}

export const hoursLabel = (h: number | null) =>
  h === null
    ? "Fixa"
    : h < 24
      ? `${h} horas`
      : h === 24
        ? "1 dia"
        : `${h / 24} dias`;

function DeviceIcon({ kind }: { kind: PlayerDevice["kind"] }) {
  const Icon = kind === "tv" ? Tv : kind === "phone" ? Smartphone : Laptop;
  return (
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
      <Icon className="h-5 w-5" />
    </span>
  );
}

/** Configuracoes > Dispositivos: aparelhos conectados a conta; desconecta um ou todos os parados. */
export function DevicesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [devices, setDevices] = useState<PlayerDevice[] | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    api
      .get<{ devices: PlayerDevice[] }>("/api/player/devices")
      .then((r) => setDevices(r.devices))
      .catch((err) => {
        toast.error((err as Error).message);
        setDevices([]);
      });
  }, []);
  useEffect(() => {
    if (open) {
      setDevices(null);
      load();
    }
  }, [open, load]);

  const disconnect = async (d: PlayerDevice) => {
    setBusy(d.id);
    try {
      await api.del(`/api/player/devices/${d.id}`);
      setDevices((list) => list?.filter((x) => x.id !== d.id) ?? null);
      toast.success(`${d.name} desconectado`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy("");
    }
  };

  const inactive = (devices ?? []).filter(
    (d) =>
      !d.current &&
      Date.now() - Date.parse(d.last_seen_at) > INACTIVE_DAYS * 24 * 3600e3,
  );
  const cleanup = async () => {
    setBusy("all");
    try {
      const r = await api.post<{ removed: number }>(
        "/api/player/devices/cleanup",
        { days: INACTIVE_DAYS },
      );
      toast.success(
        r.removed === 1
          ? "1 aparelho desconectado"
          : `${r.removed} aparelhos desconectados`,
      );
      load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Dispositivos"
      description="Aparelhos conectados à sua conta. Desconecte os que você não usa mais."
      wide
    >
      {!devices ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-3">
          {inactive.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              <span>
                {inactive.length === 1
                  ? "1 aparelho está"
                  : `${inactive.length} aparelhos estão`}{" "}
                sem uso há mais de {INACTIVE_DAYS} dias.
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={cleanup}
                disabled={busy === "all"}
              >
                {busy === "all" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Trash2 />
                )}{" "}
                Desconectar inativos
              </Button>
            </div>
          )}
          <ul className="space-y-2">
            {devices.map((d) => (
              <li
                key={d.id}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3",
                  d.current && "border-primary/50 bg-primary/5",
                )}
              >
                <DeviceIcon kind={d.kind} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold">
                      {d.name}
                    </span>
                    {d.current && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                        Este aparelho
                      </span>
                    )}
                    {d.guest && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                        Por link
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {d.label && <>{d.label} · </>}
                    {d.current
                      ? "Em uso agora"
                      : `Último uso ${ago(d.last_seen_at)}`}
                    {d.guest && (
                      <>
                        {" "}
                        ·{" "}
                        {d.ends_at
                          ? `sai em ${left(d.ends_at)}`
                          : "conexão fixa"}
                      </>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground/80">
                    Entrou em {formatDate(d.created_at)}
                    {d.ip && <> · IP {d.ip}</>}
                  </div>
                </div>
                {!d.current && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => disconnect(d)}
                    disabled={busy === d.id}
                    aria-label={`Desconectar ${d.name}`}
                  >
                    {busy === d.id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}{" "}
                    <span className="hidden sm:inline">Desconectar</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Para sair deste aparelho, use Sair da conta nas Configurações.
          </p>
        </div>
      )}
    </Dialog>
  );
}

/** Configuracoes > Conexoes: link direto (is.gd) que abre a conta ja logada no navegador de uma TV (ex: hotel). */
export function ConnectionsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<PlayerLink[] | null>(null);
  const [options, setOptions] = useState<number[]>([]);
  const [label, setLabel] = useState("");
  const [hours, setHours] = useState<number | null>(24);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<PlayerLink | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(() => {
    api
      .get<{ links: PlayerLink[]; hours: number[] }>("/api/player/links")
      .then((r) => {
        setLinks(r.links);
        setOptions(r.hours);
      })
      .catch((err) => {
        toast.error((err as Error).message);
        setLinks([]);
      });
  }, []);
  useEffect(() => {
    if (open) {
      setLinks(null);
      setCreated(null);
      load();
    }
  }, [open, load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const l = await api.post<PlayerLink>("/api/player/links", {
        label,
        hours,
      });
      setCreated(l);
      setLabel("");
      setLinks((list) => [l, ...(list ?? [])]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (l: PlayerLink) => {
    setBusy(l.id);
    try {
      await api.del(`/api/player/links/${l.id}`);
      setLinks((list) => list?.filter((x) => x.id !== l.id) ?? null);
      if (created?.id === l.id) setCreated(null);
      toast.success(
        l.state === "connected" ? "TV desconectada" : "Link cancelado",
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy("");
    }
  };

  const waiting = (links ?? []).filter((l) => l.state === "waiting");
  const connected = (links ?? []).filter((l) => l.state === "connected");

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Conexões"
      description="Crie um link que já abre a sua conta no navegador de uma TV, como a de um hotel. Sem digitar usuário e senha."
      wide
    >
      <div className="space-y-5">
        {created ? (
          <section className="space-y-3 rounded-xl border border-primary/50 bg-primary/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Link2 className="h-4 w-4 text-primary" /> Link criado
              {created.label ? `: ${created.label}` : ""}
            </h3>
            <LinkBox link={created} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreated(null)}
            >
              <Plus /> Criar outro
            </Button>
          </section>
        ) : (
          <form onSubmit={create} className="space-y-4 rounded-xl border p-4">
            <Field label="Nome da conexão (opcional)">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex: Hotel quarto 302"
                maxLength={60}
              />
            </Field>
            <div>
              <div className="mb-2 text-sm font-medium">Tempo de conexão</div>
              <div
                className="flex flex-wrap gap-2"
                role="radiogroup"
                aria-label="Tempo de conexão"
              >
                {[...options, null].map((h) => (
                  <button
                    key={h ?? "fixa"}
                    type="button"
                    role="radio"
                    aria-checked={hours === h}
                    onClick={() => setHours(h)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                      hours === h
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    {hoursLabel(h)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {hours === null
                  ? "Fixa: a TV fica conectada até você desconectar aqui ou em Dispositivos."
                  : `A TV sai da conta sozinha ${hoursLabel(hours)} depois de abrir o link.`}
              </p>
            </div>
            <Button variant="gradient" disabled={creating || !links}>
              {creating ? <Loader2 className="animate-spin" /> : <Link2 />}{" "}
              Criar link
            </Button>
          </form>
        )}

        {!links ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {connected.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">
                  TVs conectadas por link
                </h3>
                {connected.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-3 rounded-xl border p-3"
                  >
                    <DeviceIcon kind={l.device?.kind ?? "tv"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {l.label || l.device?.name || "TV"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {l.label && l.device ? `${l.device.name} · ` : ""}
                        {l.ends_at
                          ? `Sai em ${left(l.ends_at)} (${formatDate(l.ends_at)})`
                          : "Conexão fixa"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => remove(l)}
                      disabled={busy === l.id}
                    >
                      {busy === l.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <Trash2 />
                      )}{" "}
                      Desconectar
                    </Button>
                  </div>
                ))}
              </section>
            )}
            {waiting.filter((l) => l.id !== created?.id).length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Esperando abrir na TV</h3>
                {waiting
                  .filter((l) => l.id !== created?.id)
                  .map((l) => (
                    <div key={l.id} className="space-y-2 rounded-xl border p-3">
                      <div className="flex items-center gap-3">
                        <DeviceIcon kind="tv" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold">
                            {l.label || "Link de conexão"}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {hoursLabel(l.hours)} · abra até{" "}
                            {formatDate(l.open_until)}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => remove(l)}
                          disabled={busy === l.id}
                        >
                          {busy === l.id ? (
                            <Loader2 className="animate-spin" />
                          ) : (
                            <Trash2 />
                          )}{" "}
                          Cancelar
                        </Button>
                      </div>
                      {l.url && (
                        <CopyRow
                          label="Link"
                          value={l.short || l.url}
                          toastLabel="Link copiado"
                        />
                      )}
                    </div>
                  ))}
              </section>
            )}
            {!connected.length && !waiting.length && !created && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Monitor className="h-4 w-4" /> Nenhuma TV conectada por link.
              </p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

function LinkBox({ link }: { link: PlayerLink }) {
  const url = link.short || link.url || "";
  const typed = url.replace(/^https?:\/\//, "");
  const share = async () => {
    try {
      await navigator.share({
        title: "RTec TV",
        text: "Abra no navegador da TV:",
        url,
      });
    } catch {
      /* cancelado */
    }
  };
  return (
    <div className="space-y-3">
      <CopyRow
        label={link.short ? "Digite no navegador da TV" : "Link"}
        value={typed}
        large={!!link.short}
        toastLabel="Link copiado"
      />
      {!link.short && (
        <p className="text-xs text-warning">
          Não deu para encurtar no is.gd agora. Use o link completo acima.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Vale para 1 aparelho e precisa ser aberto até{" "}
        {formatDate(link.open_until)}.{" "}
        {link.hours === null
          ? "Conexão fixa."
          : `Depois de aberto, a TV fica conectada por ${hoursLabel(link.hours)}.`}{" "}
        Não mande este link para outras pessoas.
      </p>
      {"share" in navigator && (
        <Button type="button" variant="outline" size="sm" onClick={share}>
          <Share2 /> Compartilhar
        </Button>
      )}
    </div>
  );
}
