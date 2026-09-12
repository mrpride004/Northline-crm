-- Trailblazer CRM — v54: payment method + lead source tracking on orders.
--
-- payment_method distinguishes cash-on-delivery from prepaid orders, feeding
-- the "COD Customer" / "Prepaid Customer" auto-classification in customer
-- history. Defaults to 'COD' since that's the normal flow for this business
-- — dispatch collects cash at the door unless the order was paid upfront.
--
-- lead_source records where the order came from (WhatsApp, Instagram,
-- Facebook, TikTok, Website, Phone Call, Referral, Influencer, Walk-in,
-- Other) — the first building block for marketing-channel attribution
-- reporting later. Nullable: existing orders and any intake path that
-- doesn't set it explicitly just show as unset rather than guessing wrong.
--
-- Already applied directly to production via the Supabase MCP connection.
-- Kept here as the source-of-truth record of the schema change.

alter table orders add column if not exists payment_method text not null default 'COD';
alter table orders add constraint orders_payment_method_check
  check (payment_method in ('COD', 'Prepaid'));

alter table orders add column if not exists lead_source text;
alter table orders add constraint orders_lead_source_check
  check (lead_source is null or lead_source in (
    'WhatsApp', 'Instagram', 'Facebook', 'TikTok', 'Website',
    'Phone Call', 'Referral', 'Influencer', 'Walk-in', 'Other'
  ));
