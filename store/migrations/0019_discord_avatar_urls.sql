-- Discord stores only an avatar hash; the displayable image lives at the CDN.
-- Logins now persist a full CDN URL (see auth.discordAvatarURL), so backfill the
-- bare hashes left by earlier logins. Rows already holding a URL (Google, or a
-- post-change Discord login) start with "http" and are skipped; empty avatars
-- stay empty so the UI keeps its generated color-disc fallback. Animated avatars
-- (hash prefixed "a_") are served as .gif, everything else as .png.

UPDATE users
SET avatar = 'https://cdn.discordapp.com/avatars/' || discord_id || '/' || avatar ||
    CASE WHEN avatar LIKE 'a\_%' ESCAPE '\' THEN '.gif' ELSE '.png' END || '?size=128'
WHERE discord_id IS NOT NULL
  AND avatar <> ''
  AND avatar NOT LIKE 'http%';

UPDATE identities
SET avatar = 'https://cdn.discordapp.com/avatars/' || provider_id || '/' || avatar ||
    CASE WHEN avatar LIKE 'a\_%' ESCAPE '\' THEN '.gif' ELSE '.png' END || '?size=128'
WHERE provider = 'discord'
  AND avatar <> ''
  AND avatar NOT LIKE 'http%';
