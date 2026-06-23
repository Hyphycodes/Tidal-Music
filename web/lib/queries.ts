// Shared read queries used by BOTH the API routes and the server-rendered Detail
// pages — one source of truth, one round-trip each (no client N+1).
import { sql } from "@/lib/db";
import type { ArtistDetail, ListDetail, ListSummary, TrackDetail } from "@/lib/types";

export async function getTrackDetail(id: string): Promise<TrackDetail | null> {
  const rows = (await sql`
    select
      t.id, t.title, t.artist_name, t.album_title, t.genre, t.energy, t.bpm,
      t.musical_key, t.saved_at, t.release_date, t.duration_sec,
      t.mbid, t.isrc, t.primary_artist_id, t.album_id, t.mood,
      (select json_build_object('id', r.id, 'title', r.title, 'year', r.year,
              'country', r.country, 'label', l.name)
         from releases r left join labels l on l.id = r.label_id
        where r.id = t.album_id) as release,
      coalesce((select json_agg(json_build_object('artist_id', ta.artist_id, 'name', a.name, 'role', ta.role))
         from track_artists ta join artists a on a.id = ta.artist_id
        where ta.track_id = t.id), '[]'::json) as artists,
      coalesce((select json_agg(json_build_object('person_id', c.person_id, 'name', p.name,
              'role', c.role, 'source', c.source, 'confidence', c.confidence) order by c.role)
         from credits c join people p on p.id = c.person_id
        where c.track_id = t.id), '[]'::json) as credits,
      coalesce((select json_agg(json_build_object('tag', g.tag, 'value', g.value,
              'source', g.source, 'confidence', g.confidence))
         from tags g where g.entity_type = 'track' and g.entity_id = t.id), '[]'::json) as tags,
      coalesce(
        (select json_build_object('entity_type', 'release', 'entity_id', n.entity_id, 'body', n.body, 'model', n.model)
           from narratives n where n.entity_type = 'release' and n.entity_id = t.album_id),
        (select json_build_object('entity_type', 'artist', 'entity_id', n.entity_id, 'body', n.body, 'model', n.model)
           from narratives n where n.entity_type = 'artist' and n.entity_id = t.primary_artist_id)
      ) as narrative
    from tracks t
    where t.id = ${id}
  `) as unknown as TrackDetail[];
  return rows[0] ?? null;
}

export async function getArtistDetail(id: string): Promise<ArtistDetail | null> {
  const rows = (await sql`
    select
      a.id, a.name, a.origin_city, a.origin_country, a.began_year, a.scene,
      coalesce((select json_agg(json_build_object(
              'id', t.id, 'title', t.title, 'artist_name', t.artist_name, 'album_title', t.album_title,
              'genre', t.genre, 'energy', t.energy, 'bpm', t.bpm, 'musical_key', t.musical_key,
              'saved_at', t.saved_at, 'release_date', t.release_date, 'duration_sec', t.duration_sec)
              order by t.saved_at desc)
         from tracks t where t.primary_artist_id = a.id), '[]'::json) as tracks,
      coalesce((select json_agg(json_build_object(
              'artist_id', oa.id, 'name', oa.name, 'kind', r.kind, 'weight', r.weight)
              order by r.weight desc)
         from relationships r
         join artists oa on oa.id = (case when r.artist_a = a.id then r.artist_b else r.artist_a end)
        where r.artist_a = a.id or r.artist_b = a.id), '[]'::json) as connections,
      (select json_build_object('entity_type', 'artist', 'entity_id', n.entity_id, 'body', n.body, 'model', n.model)
         from narratives n where n.entity_type = 'artist' and n.entity_id = a.id) as narrative
    from artists a
    where a.id = ${id}
  `) as unknown as ArtistDetail[];
  return rows[0] ?? null;
}

export async function getLists(): Promise<ListSummary[]> {
  return (await sql`
    select l.id, l.title, l.kind, l.notes, l.updated_at, count(li.id)::int as item_count
      from lists l
      left join list_items li on li.list_id = l.id
     group by l.id
     order by l.updated_at desc
  `) as unknown as ListSummary[];
}

export async function getListDetail(id: string): Promise<ListDetail | null> {
  const rows = (await sql`
    select l.id, l.title, l.kind, l.notes, l.updated_at,
      (select count(*)::int from list_items where list_id = l.id) as item_count,
      coalesce((select json_agg(json_build_object(
          'item_id', li.id, 'rank', li.rank, 'note', li.note, 'rating', li.rating,
          'track', json_build_object('id', t.id, 'title', t.title, 'artist_name', t.artist_name,
            'album_title', t.album_title, 'genre', t.genre, 'energy', t.energy, 'bpm', t.bpm,
            'musical_key', t.musical_key, 'saved_at', t.saved_at, 'release_date', t.release_date,
            'duration_sec', t.duration_sec))
          order by li.rank nulls last, li.created_at)
        from list_items li join tracks t on t.id = li.track_id
       where li.list_id = l.id), '[]'::json) as items
    from lists l
    where l.id = ${id}
  `) as unknown as ListDetail[];
  return rows[0] ?? null;
}
