export type Links = { m3u: string; m3u_token: string; server: string };

export type PlaybackMode = "auto" | "direct" | "proxy";

export type SourceKind = "m3u_url" | "xtream" | "manual";

export type Source = {
  kind: SourceKind;
  url: string;
  xtream_server: string;
  xtream_username: string;
  xtream_password: string;
  content: string;
  epg_url: string;
  playback: PlaybackMode;
};

export type Client = {
  id: string;
  name: string;
  username: string;
  password: string;
  token: string;
  active: boolean;
  valid: boolean;
  expires_at: string | null;
  notes: string;
  last_access_at: string | null;
  created_at: string;
  playlist_ids: string[];
  source: Source | null;
  custom_pin: boolean;
  links: Links;
};

export type PlaylistKind = "m3u_url" | "xtream" | "manual";

export type Playlist = {
  id: string;
  name: string;
  kind: PlaylistKind;
  url: string;
  xtream_server: string;
  xtream_username: string;
  xtream_password: string;
  content: string;
  epg_url: string;
  playback: PlaybackMode;
  active: boolean;
  client_count: number;
  channel_count: number | null;
};


export type Stats = {
  clients: number;
  active_clients: number;
  expired_clients: number;
  playlists: number;
  recent: { id: string; name: string; username: string; last_access_at: string }[];
};

export type Preview = {
  ok: boolean;
  kinds?: { live: number; movie: number; series: number };
  xtream?: {
    status: string;
    expires_at: string | null;
    max_connections: number | null;
    categories: { live: number; movie: number; series: number };
  };
  source: string | null;
  error?: string;
  channel_count?: number;
  groups?: string[];
  entries?: { name: string; group: string; logo: string; url: string }[];
};

export type Channel = {
  id: string;
  name: string;
  group: string;
  logo: string;
  src: string;
  type: "hls" | "mpegts" | "file";
  kind: "live" | "movie" | "series";
  epg_id: string;
  playlist_id: string;
  series_id?: string;
  season?: number;
  episode?: number;
  alt: string;
  alt_type: "hls" | "mpegts" | "file" | "";
};

export type Catalog = {
  mode: "xtream" | "m3u";
  sections?: Record<"live" | "movie" | "series", { id: string; name: string }[]>;
  errors?: string[];
};

export type ChannelsResponse = {
  playlists: { id: string; name: string }[];
  channels: Channel[];
  errors?: string[];
  no_source?: boolean;
};

export type Programme = { start: string; stop: string; title: string; desc: string };

export type PlayerSettings = { custom_pin: boolean; locked_groups: string[] };

export type ClientProfile = { name: string; username: string; expires_at: string | null };

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
