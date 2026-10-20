import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";
import { api, type ClientProfile } from "@/lib/api";
import { activationUrl, getDeviceIdentity } from "@/lib/device";
import CopyRow from "@/components/CopyRow";

/** Mostra Device ID + Key e QR code; consulta o servidor ate o revendedor vincular o aparelho. */
export default function DeviceActivation({ onLinked }: { onLinked: (p: ClientProfile) => void }) {
  const device = getDeviceIdentity();
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const linked = useRef(onLinked);
  linked.current = onLinked;

  useEffect(() => {
    QRCode.toDataURL(activationUrl(device), { margin: 1, width: 220, color: { dark: "#0b0b10", light: "#ffffff" } }).then(setQr);
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
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-3">
          <CopyRow label="Device ID" value={device.device_id} toastLabel="ID copiado" />
          <CopyRow label="Device Key" value={device.device_key} toastLabel="Chave copiada" large />
        </div>
        <div className="mx-auto grid aspect-square w-40 place-items-center rounded-xl bg-white p-2 sm:w-[132px]">
          {qr ? <img src={qr} alt="QR code de ativação" className="h-full w-full" /> : <Loader2 className="h-5 w-5 animate-spin text-black/40" />}
        </div>
      </div>
      {error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 py-3 text-center text-sm text-destructive">{error}</p>
      ) : (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-muted/60 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Aguardando ativação...
        </div>
      )}
      <p className="text-center text-xs text-muted-foreground">
        Envie estes dados ao seu revendedor ou peça para ele escanear o QR code. A tela entra sozinha assim que o aparelho for ativado.
      </p>
    </div>
  );
}
