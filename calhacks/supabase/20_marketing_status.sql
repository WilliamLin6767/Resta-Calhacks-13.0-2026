-- =====================================================================
-- Marketing posts: no more deleted drafts, one publish at a time, and photo credits. Run AFTER 16.
-- Safe to re-run. No row is deleted or rewritten.
--
--   archived    a new set of drafts archives the old unposted ones instead of deleting them
--   publishing  the publish claims the post first (draft or failed -> publishing), so a double
--               tap can't post it twice (lib/marketing/publish.ts)
--   photo_*     where the photo came from: the owner's upload, or a stock photo with its creator,
--               license and source page; credit is the line added to the caption
-- =====================================================================

alter table marketing_posts drop constraint if exists marketing_posts_status;
alter table marketing_posts
  add constraint marketing_posts_status check (status in ('draft', 'publishing', 'posted', 'failed', 'archived'));

alter table marketing_posts add column if not exists archived_at timestamptz;
alter table marketing_posts add column if not exists photo_source text;      -- 'owner' or 'stock'
alter table marketing_posts add column if not exists photo_creator text;
alter table marketing_posts add column if not exists photo_license text;
alter table marketing_posts add column if not exists photo_source_url text;
alter table marketing_posts add column if not exists credit text;            -- "Photo: Jane Doe, CC BY 2.0"
