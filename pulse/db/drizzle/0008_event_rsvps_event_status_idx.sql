-- P-I2 (pulse) — composite index for status-filtered RSVP reads.
-- `GET /events/:id/rsvps?status=…` and the counts GROUP BY seek on
-- event_id then filter on status; the existing `event_rsvps_event_idx`
-- leaves the status filter as a post-index scan.
CREATE INDEX `event_rsvps_event_status_idx` ON `event_rsvps` (`event_id`,`status`);
