export type Links = { m3u: string; m3u_token: string; server: string };

export type Client = {
  id: number;
  name: string;
  username: string;
  password: string;
  token: string;
  active: boolean;
  valid: boolean;
  max_devices: number;
  expires_at: string | null;
  notes: string;
  last_access_at: string | null;
  created_at: string;
  playlist_ids: number[];
  device_count: number;
  links: Links;
};

export type PlaylistKind = "m3u_url" | "xtream" | "manual";

export type Playlist = {
  id: number;
  name: string;
  kind: PlaylistKind;
  url: string;
  xtream_server: string;
  xtream_username: string;
  xtream_password: string;
  content: string;
  epg_url: string;
  active: boolean;
  client_count: number;
  channel_count: number | null;
};

export type Device = {
  id: number;
  client_id: number;
  client_username: string;
  client_name: string;
  mac: string;
  device_key: string;
  label: string;
  last_seen_at: string | null;
  created_at: string;
};

export type Stats = {
  clients: number;
  active_clients: number;
  expired_clients: number;
  playlists: number;
  devices: number;
  recent: { id: number; name: string; username: string; last_access_at: string }[];
};

export type Preview = {
  ok: boolean;
  source: string | null;
  error?: string;
  channel_count?: number;
  groups?: string[];
  entries?: { name: string; group: string; logo: string; url: string }[];
};

export type PortalData = {
  name: string;
  username: string;
  expires_at: string | null;
  max_devices: number;
  links: Links;
  playlists: { id: number; name: string }[];
  devices: { mac: string; label: string; last_seen_at: string | null }[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Erro ${res.status}`);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};
