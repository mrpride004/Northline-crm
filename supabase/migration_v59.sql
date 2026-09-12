-- Trailblazer CRM — v59: review-request tracking.
--
-- review_requested_at records the last time staff/admin asked a delivered
-- customer for a review, so the "Request review" action can show "already
-- asked Xh ago" instead of staff accidentally re-pinging the same customer
-- repeatedly. Nothing more is stored — the message itself and the review
-- link live in app_settings (review_request_message, review_link), same
-- pattern as the existing auto_confirm_message setting.

alter table orders add column if not exists review_requested_at timestamptz;
