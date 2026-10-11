# Story 1.3: Sequential Housekeeping Worker (Cron)
As a system, I want to process jobs via a scheduled loop, so that memory footprint remains minimal.
**Acceptance Criteria:**
- **Given** pending jobs in the DB.
- **When** the cron triggers every 5 mins.
- **Then** jobs are processed one-by-one with a batch limit of 5 and per-service timeouts.
