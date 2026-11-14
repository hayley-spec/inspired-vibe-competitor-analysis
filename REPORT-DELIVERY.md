# Analysis report delivery

Additive implementation based on founder release d44d3f6. Existing Neon and ADMIN_KEY are reused, never replaced. New table iv_competitor_reports stores recipient, paired canonical score JSON, request ID, timestamps and email state. PDF is rendered from the saved JSON rather than rescanning websites; admin download uses the same renderer.

## Required setup before activating
1. Install/connect Resend in the Hayley’s 7-mm Vercel team and this project, on an approved free plan.
2. Add report.inspiredvibe.com in Resend; copy its actual provider-specified DNS records to the owner. No DNS values should be guessed.
3. Add new server-only RESEND_API_KEY and REPORT_FROM_EMAIL (for example Inspired Vibe <reports@report.inspiredvibe.com>) without replacing existing settings.
4. After Resend confirms domain verification set REPORT_EMAIL_ENABLED=true, deploy and verify with an explicitly authorized test recipient.
5. Admin remains /#/leads using existing access key. Report listing/download protected by existing server sessions; no credential is exposed in client or URLs.

## Safeguards and limits
Public input validated; deterministic request UUID prevents repeat processing. Database advisory lock plus persistent rate limit caps three per source IP/email per hour. Input results cannot be supplied by client. Only server-produced scores saved/sent. API logs exclude report responses and recipient data. PDF links only HTTP(S), no embedded scripts. Resend idempotency key prevents repeat sends for a request. Provider acceptance is NOT a delivery receipt.

Processing remains within one awaited Vercel function (300s budget), not a durable queue. If the function is forcibly terminated it can leave a processing row: admin must investigate, not silently resubmit or double-send. Failed/uncertain email statuses never claim delivery. No background automatic retries or backfill yet; old rows remain visible and PDFs downloadable. New report pages show honest non-delivery status while Resend awaits configuration. A durable queue and signed Resend delivery webhook are recommended next additions before high-volume usage.

Validation: unit tests mock outbound Resend; no live messages sent or live forms submitted. End-to-end Neon persistence, provider delivery and signed-in admin verification are outstanding until setup/login and explicit test authorization.
