-- Trailblazer CRM — v40: commission claims now go through admin approval
-- before the balance actually clears. Clicking "Claim" creates a Pending
-- request — the staff member's unclaimed balance stays visible and intact
-- until admin approves it (confirming they've actually been paid outside
-- the system). Existing historical claims are backfilled as Approved so old
-- balances aren't disrupted — only new claims start Pending.
-- Run in Supabase: SQL Editor > New query > paste all > Run

alter table commission_claims add column if not exists status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected'));
alter table commission_claims add column if not exists reviewed_by uuid references profiles(id);
alter table commission_claims add column if not exists reviewed_at timestamptz;

update commission_claims set status = 'Approved' where status = 'Pending';

create or replace function approve_commission_claim(p_claim_id uuid)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Only admin can approve a commission claim';
  end if;
  update commission_claims set status = 'Approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_claim_id and status = 'Pending';
end;
$$ language plpgsql security definer;
grant execute on function approve_commission_claim(uuid) to authenticated;

create or replace function reject_commission_claim(p_claim_id uuid)
returns void as $$
begin
  if not is_admin() then
    raise exception 'Only admin can reject a commission claim';
  end if;
  update commission_claims set status = 'Rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_claim_id and status = 'Pending';
end;
$$ language plpgsql security definer;
grant execute on function reject_commission_claim(uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
