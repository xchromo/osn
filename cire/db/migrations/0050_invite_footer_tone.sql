-- Section tone for the invite's CLOSING SECTION — the couple's sign-off (their
-- motif from `0049` over their note from `0048`), rendered as its own section
-- immediately above the always-shown site footer.
--
-- It is a real invite section, so like `hero_tone` / `story_tone` /
-- `details_tone` / `welcome_tone` it records which derived surface it sits on
-- (`ground` | `card` | `raised`). NULL ⇒ the page ground, which is what every
-- existing wedding reads as, so nothing changes until an organiser picks a tone.
ALTER TABLE `wedding_invite_customisations` ADD `footer_tone` text;
