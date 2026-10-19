// Identidade do aparelho no modelo Duplecast: um "Device ID" (formato MAC) e uma "Device Key" de 6 digitos,
// criados uma vez e guardados no navegador/app instalado.
export type DeviceIdentity = { device_id: string; device_key: string };

const KEY = "rtec:device";

function generate(): DeviceIdentity {
  const bytes = crypto.getRandomValues(new Uint8Array(7));
  bytes[0] = (bytes[0] & 0xfc) | 0x02; // MAC "administrado localmente", nao colide com placas reais
  const id = Array.from(bytes.slice(0, 6), (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  const key = String(100000 + (new DataView(bytes.buffer).getUint32(2) % 900000));
  return { device_id: id, device_key: key };
}

let memory: DeviceIdentity | null = null;

export function getDeviceIdentity(): DeviceIdentity {
  if (memory) return memory;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved?.device_id && saved?.device_key) return (memory = saved);
  } catch {
    /* sem armazenamento: usa um codigo so desta sessao */
  }
  memory = generate();
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* ignore */
  }
  return memory;
}

export const activationUrl = (d: DeviceIdentity) =>
  `${location.origin}/admin/dispositivos?id=${encodeURIComponent(d.device_id)}&key=${d.device_key}`;
