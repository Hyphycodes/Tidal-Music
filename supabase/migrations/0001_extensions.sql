-- 0001_extensions.sql — required Postgres extensions
-- Safe to re-run (IF NOT EXISTS guards).
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive unique names (upsert-by-name)
create extension if not exists vector;     -- pgvector: track_embeddings similarity
