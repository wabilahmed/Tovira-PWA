-- 0038_embedding_dim_512.sql — STAGING-EMBEDDER dimension decision.
--
-- Titan Text Embeddings V2 emits 1024 dims by default and also supports 512/256. We
-- standardise on 512 (the EMBED_DIM default): it HALVES vector storage and ANN-index
-- RAM versus 1024, which matters on a t4g.small (2GB shared with Postgres), with
-- negligible retrieval-quality loss on Titan-v2. Projected raw-vector storage at 170
-- users: ~340MB @ 512 vs ~680MB @ 1024 (1000 notes/user); the gap roughly doubles once
-- an ANN index is added.
--
-- Every existing embedding was produced by the STUB embedder (semantically
-- meaningless) and is 1024-dim, so we simply drop and re-add the column at 512 — real
-- content re-embeds with Titan-512 going forward. PRE-FIX CONTENT IS UNSEARCHABLE until
-- re-embedded (there is no real content yet; QA data is torn down each run). No ANN
-- index exists on the column, so there is none to drop.
--
-- The column dimension MUST match config.embedDim; changing EMBED_DIM later needs a
-- new migration here plus a full re-embed.
ALTER TABLE notes DROP COLUMN IF EXISTS embedding;
ALTER TABLE notes ADD COLUMN embedding vector(512);
