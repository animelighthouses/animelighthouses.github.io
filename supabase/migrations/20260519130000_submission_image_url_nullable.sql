-- Public submissions may include only an AniList URL (image added at review).
ALTER TABLE public.sighting_submissions
  ALTER COLUMN image_url DROP NOT NULL;
