export type Links = { server: string };

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
  active: boolean;
  valid: boolean;
  /** Vencimento informado pelo fornecedor (Xtream). */
  expires_at: string | null;
  list_status: ListStatus | null;
  notes: string;
  last_access_at: string | null;
  created_at: string;
  playlist_ids: string[];
  source: Source | null;
  /** Listas extras: completam a principal no mesmo catalogo (titulos repetidos aparecem uma vez). */
  extra_sources?: Source[];
  custom_pin: boolean;
  links: Links;
};

/** Resultado da conferencia automatica da lista no fornecedor. */
export type ListStatus = {
  state: "active" | "expired" | "unknown" | "none";
  reason: string;
  checked_at: string | null;
  last_error: string;
  provider_status: string;
  /** Com varias listas: estado de cada uma (pela chave da lista). */
  sources?: Record<string, ListStatus["state"]>;
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
  kinds?: { live: number; radio?: number; movie: number; series: number };
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
  kind: "live" | "radio" | "movie" | "series";
  epg_id: string;
  playlist_id: string;
  series_id?: string;
  /** Para ordenar: quando entrou no catalogo (unix s), ano de lancamento e nota (0 a 10). */
  added?: number;
  year?: number;
  rating?: number;
  genres?: string[];
  /** Episodio: id da serie a que pertence (para achar o proximo). */
  parent_series?: string;
  /** Episodio: capa da serie (o logo do episodio costuma ser a cena dele). */
  cover?: string;
  xt_id?: string; // id do filme no fornecedor (ficha do titulo)
  season?: number;
  episode?: number;
  alt: string;
  alt_type: "hls" | "mpegts" | "file" | "";
  /** Link pelo servidor de video, usado se o direto falhar (app). */
  fallback?: string;
  /** O mesmo titulo nas outras listas do cliente: tentado em ordem se este nao tocar. */
  more?: PlayLink[];
  /** Filme/episodio com mais de uma versao (dublado, legendado, 4K...): a que esta nos links acima e todas. */
  tag?: string;
  versions?: Version[];
  /** Recomendacoes: por que o titulo foi sugerido ("Direção de ...", "Com ..."). */
  reasons?: string[];
};

export type PlayLink = Pick<Channel, "src" | "type" | "alt" | "alt_type" | "fallback">;

/** Uma versao do titulo: tag "L|4K" (legendado, 4K), nome para mostrar e os links dela. */
export type Version = PlayLink & { tag: string; label: string; more?: PlayLink[] };

export type Catalog = {
  mode: "xtream" | "m3u";
  sections?: Record<"live" | "radio" | "movie" | "series", { id: string; name: string }[]>;
  errors?: string[];
  /** Xtream: identifica a lista (servidor e usuario); muda quando o link e trocado. */
  sig?: string;
};

/**
 * Pular intro / Proximo EP: tempos (s) achados no servidor. intro: [inicio, fim]; credits: onde comecam os
 * creditos; post: ha cena pos-creditos (o Proximo EP so aparece no fim).
 */
export type EpisodeMarks = { intro: [number, number] | null; credits: number | null; post: boolean };

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
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** O fornecedor cortou a lista do cliente (vencida/bloqueada). */
export const isListExpired = (err: unknown) => err instanceof ApiError && err.code === "list_expired";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Erro ${res.status}`, data.code);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>("PUT", url, body),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/** Jogos do dia: agenda montada no servidor, ja com os canais da lista do cliente que passam cada jogo. */
export type GameTeam = { name: string; logo: string; score: string };
export type Game = {
  id: string;
  start: string;
  league: string;
  league_id: string;
  /** "Futebol", "Basquete", "Futebol americano". */
  sport: string;
  home: GameTeam;
  away: GameTeam;
  state: "pre" | "in" | "post";
  detail: string;
  /** Onde passa no Brasil (canais e streaming). */
  broadcasts: string[];
  /** A fonte nao informou o canal: sao os canais de costume do campeonato. */
  guessed: boolean;
  channels: (Channel & { broadcast: string })[];
};
export type GameLeague = { id: string; name: string; sport: string };
export type GamesResponse = { updated_at: string; games: Game[]; leagues: GameLeague[] };

/** Ficha de um filme/serie (fornecedor + internet). */
export type TitleInfo = {
  name: string;
  original_name?: string;
  plot: string;
  tagline?: string;
  genres: string[];
  cast: string[];
  director: string[];
  year: number;
  release_date?: string;
  rating: number;
  minutes: number;
  country?: string;
  age?: string;
  poster: string;
  backdrop: string;
  trailer: string;
  seasons?: number;
  source?: string;
  link?: string;
};

