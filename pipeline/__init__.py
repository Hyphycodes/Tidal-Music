"""Crate data pipeline.

Ingest Tidal → enrich (MusicBrainz, Discogs, Claude) → derive relationships →
refresh stats → observe. Every worker is resumable via the `enrichment_jobs`
table and runnable as `python -m pipeline.<name>`.
"""
