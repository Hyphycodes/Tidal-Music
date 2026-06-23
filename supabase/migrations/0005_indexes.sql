-- 0005_indexes.sql — speed doctrine: index every filter / sort / join column (§3)

-- ── tracks hot paths ───────────────────────────────────────────────────────
create index if not exists idx_tracks_saved_at      on tracks (saved_at desc);
create index if not exists idx_tracks_saved_keyset   on tracks (saved_at desc, id desc); -- keyset pagination
create index if not exists idx_tracks_primary_artist on tracks (primary_artist_id);
create index if not exists idx_tracks_album          on tracks (album_id);
create index if not exists idx_tracks_genre          on tracks (genre);
create index if not exists idx_tracks_energy         on tracks (energy);
create index if not exists idx_tracks_artist_name_lc on tracks (lower(artist_name));
create index if not exists idx_tracks_release_date   on tracks (release_date);
create index if not exists idx_tracks_bpm            on tracks (bpm);
create index if not exists idx_tracks_mbid           on tracks (mbid);
-- isrc: unique only when present
create unique index if not exists uq_tracks_isrc     on tracks (isrc) where isrc is not null;

-- ── entity lookup keys ─────────────────────────────────────────────────────
create index if not exists idx_artists_mbid          on artists (mbid);
create index if not exists idx_releases_label        on releases (label_id);
create unique index if not exists uq_releases_mbid   on releases (mbid) where mbid is not null;
create index if not exists idx_people_mbid           on people (mbid);

-- ── join tables ────────────────────────────────────────────────────────────
create index if not exists idx_credits_track         on credits (track_id);
create index if not exists idx_credits_person        on credits (person_id);
create index if not exists idx_track_artists_artist  on track_artists (artist_id);
create index if not exists idx_track_artists_track   on track_artists (track_id);
create index if not exists idx_playlist_tracks_track on playlist_tracks (track_id);

-- ── relationships graph ────────────────────────────────────────────────────
create index if not exists idx_relationships_a       on relationships (artist_a);
create index if not exists idx_relationships_b       on relationships (artist_b);
create index if not exists idx_relationships_kind    on relationships (kind);

-- ── tags / jobs / lists ────────────────────────────────────────────────────
create index if not exists idx_tags_entity           on tags (entity_type, entity_id);
create index if not exists idx_enrichment_jobs_poll  on enrichment_jobs (source, status);
create index if not exists idx_list_items_list       on list_items (list_id);
create index if not exists idx_list_items_track      on list_items (track_id);

-- ── vector similarity (cosine) — HNSW for fast ANN recommendations ─────────
create index if not exists idx_track_embeddings_hnsw
  on track_embeddings using hnsw (embedding vector_cosine_ops);
