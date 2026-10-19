import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";
import { api, type ClientProfile } from "@/lib/api";
import { activationUrl, getDeviceIdentity } from "@/lib/device";
import { copy } from "@/lib/utils";

/** Mostra Device ID + Key e QR code; consulta o servidor ate o revendedor vincular o aparelho. */
export default function DeviceActivation({ onLinked }: { onLinked: (p: ClientProfile) => void }) {
  const device = getDeviceIdentity();
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const linked = useRef(onLinked);
  linked.current = onLinked;

  useEffect(() => {
    QRCode.toDataURL(activationUrl(device), { margin: 1, width: 220, color: { dark: "#0a0a0c", light: "#ffffff" } }).then(setQr);
    api.post("/api/player/device/register", device).catch((err) => setError((err as Error).message));

    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const q = new URLSearchParams(device).toString();
        const res = await api.get<{ linked: boolean; profile?: ClientProfile }>(`/api/player/device/status?${q}`);
        if (res.linked && res.profile) return linked.current(res.profile);
      } catch (err) {
        setError((err as Error).message);
      }
      setTimeout(poll, 5000);
    };
    const t = setTimeout(poll, 1500);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [device]);

  return (
    <div className="space-y-5 text-center">
      <p className="text-sm text-muted-foreground">
        Envie estes dados ao seu revendedor ou peca para ele escanear o QR code. A tela entra sozinha assim que o aparelho for ativado.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => copy(device.device_id, "ID copiado")} className="rounded-lg border bg-muted/40 p-3 hover:bg-muted">
          <div className="text-xs text-muted-foreground">Device ID</div>
          <div className="mt-1 break-all font-mono text-xs font-semibold sm:text-sm">{device.device_id}</div>
        </button>
        <button onClick={() => copy(device.device_key, "Chave copiada")} className="rounded-lg border bg-muted/40 p-3 hover:bg-muted">
          <div className="text-xs text-muted-foreground">Device Key</div>
          <div className="mt-1 font-mono text-lg font-semibold tracking-[0.3em]">{device.device_key}</div>
        </button>
      </div>
      {qr && <img src={qr} alt="QR code de ativacao" className="mx-auto h-44 w-44 rounded-lg" />}
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Aguardando ativacao...
        </p>
      )}
    </div>
  );
}
