// GET /api/stats — all Atlas aggregates, read straight from materialized views.
// NO request-time GROUP BY (speed doctrine §3.2). Budget: < 200ms.
import { sql } from "@/lib/db";
import { cachedJson, errorJson } from "@/lib/http";
import type { Stats } from "@/lib/types";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  try {
    const [artists, producers, labels, genres, decades, countries, timeline, presence] = await Promise.all([
      sql`select artist_id, name, track_count from mv_artist_counts order by track_count desc limit 25`,
      sql`select person_id, name, track_count from mv_producer_counts order by track_count desc limit 25`,
      sql`select label_id, name, track_count from mv_label_counts order by track_count desc limit 25`,
      sql`select genre, track_count from mv_genre_distribution order by track_count desc limit 30`,
      sql`select decade, track_count from mv_decade_distribution order by decade asc`,
      sql`select country, track_count from mv_country_distribution order by track_count desc limit 30`,
      sql`select month, track_count from mv_save_timeline order by month asc`,
      sql`select in_playlist, track_count from mv_playlist_presence`,
    ]);
    const stats: Stats = {
      top_artists: artists as unknown as Stats["top_artists"],
      top_producers: producers as unknown as Stats["top_producers"],
      top_labels: labels as unknown as Stats["top_labels"],
      genres: genres as unknown as Stats["genres"],
      decades: decades as unknown as Stats["decades"],
      countries: countries as unknown as Stats["countries"],
      timeline: timeline as unknown as Stats["timeline"],
      playlist_presence: presence as unknown as Stats["playlist_presence"],
    };
    return cachedJson(stats);
  } catch {
    return errorJson("stats query failed", 500);
  }
}
