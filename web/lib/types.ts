// Shared response types. Lean by design — endpoints return exactly what a screen
// renders (speed doctrine §3.9). Mirrors the schema in supabase/migrations.

export type Source = "musicbrainz" | "discogs" | "claude" | "tidal" | "local";

/** A library list row — render-ready, NO client-side joins required. */
export interface TrackRow {
  id: string;
  title: string;
  artist_name: string;
  album_title: string | null;
  genre: string | null;
  energy: number | null;
  bpm: number | null;
  musical_key: string | null;
  saved_at: string | null;
  release_date: string | null;
  duration_sec: number | null;
}

export interface LibraryResponse {
  items: TrackRow[];
  nextCursor: string | null;
}

export interface Tag {
  tag: string;
  value: string | null;
  source: Source;
  confidence: number | null;
}

export interface Credit {
  person_id: string;
  name: string;
  role: string;
  source: string | null;
  confidence: number | null;
}

export interface Narrative {
  entity_type: "artist" | "release";
  entity_id: string;
  body: string;
  model: string | null;
}

export interface TrackArtist {
  artist_id: string;
  name: string;
  role: string;
}

/** Full track record for the Detail screen — one round-trip, no follow-ups. */
export interface TrackDetail extends TrackRow {
  mbid: string | null;
  isrc: string | null;
  mood: string[] | null;
  primary_artist_id: string | null;
  album_id: string | null;
  release: { id: string; title: string | null; year: number | null; country: string | null; label: string | null } | null;
  artists: TrackArtist[];
  credits: Credit[];
  tags: Tag[];
  narrative: Narrative | null;
}

export interface ConnectionEdge {
  artist_id: string;
  name: string;
  kind: "shared_producer" | "same_label" | "same_scene" | "same_session";
  weight: number;
}

export interface ArtistDetail {
  id: string;
  name: string;
  origin_city: string | null;
  origin_country: string | null;
  began_year: number | null;
  scene: string | null;
  tracks: TrackRow[];
  connections: ConnectionEdge[];
  narrative: Narrative | null;
}

export interface Stats {
  top_artists: { artist_id: string; name: string; track_count: number }[];
  top_producers: { person_id: string; name: string; track_count: number }[];
  top_labels: { label_id: string; name: string; track_count: number }[];
  genres: { genre: string; track_count: number }[];
  decades: { decade: number; track_count: number }[];
  countries: { country: string; track_count: number }[];
  timeline: { month: string; track_count: number }[];
  playlist_presence: { in_playlist: boolean; track_count: number }[];
}

export interface Observation {
  id: string;
  body: string;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface Recommendation {
  kind: "adjacent" | "label_gap" | "under_explored";
  reason: string;
  track_id?: string;
  artist_id?: string;
  title?: string;
  artist_name?: string;
  label?: string;
}

export interface QueryResponse {
  answer: string;
  rows: Record<string, unknown>[];
  columns: string[];
  sql: string;
  grounded: boolean;
  error?: string;
}

export interface ListSummary {
  id: string;
  title: string;
  kind: string | null;
  notes: string | null;
  item_count: number;
  updated_at: string;
}

export interface ListItem {
  item_id: string;
  rank: number | null;
  note: string | null;
  rating: number | null;
  track: TrackRow;
}

export interface ListDetail extends ListSummary {
  items: ListItem[];
}
