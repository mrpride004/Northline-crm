# Northline CRM — Setup Guide

No coding needed. Follow these steps in order — should take about 20–30 minutes
the first time.

## 1. Create a free Supabase account (your database + logins)

1. Go to https://supabase.com and sign up (free).
2. Click "New project". Pick any name and a strong database password (save it somewhere).
3. Once it's ready, go to the **SQL Editor** in the left menu.
4. Open the file `supabase/schema.sql` from this folder, copy ALL of it, paste it
   into the SQL Editor, and click **Run**. This creates your tables and security rules.
5. Go to **Settings > API** in the left menu. You'll need three values from this page
   in step 3 below:
   - Project URL
   - anon / public key
   - service_role key (click "Reveal" — keep this one secret)

## 2. Create your own admin login

1. In Supabase, go to **Authentication > Users > Add user**.
2. Enter your own email and a password. Click "Auto Confirm User" if offered.
3. Go to **Table Editor > profiles > Insert row**.
   - `id`: copy the user ID from the user you just created (Authentication > Users)
   - `full_name`: your name
   - `role`: type exactly `admin`
4. Save.

## 3. Deploy the app on Vercel (free hosting)

1. Go to https://vercel.com and sign up (free) — "Continue with GitHub" is easiest.
2. If you don't have GitHub yet, make a free account at https://github.com first,
   create a new repository, and upload this entire folder to it.
3. Back in Vercel, click "Add New > Project", and import that GitHub repository.
4. Before clicking Deploy, open "Environment Variables" and add these three
   (values from Supabase step 1.5 above):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Click **Deploy**. In about a minute, you'll get a live link like
   `northline-crm.vercel.app` — that's your CRM, live on the internet.

## 4. Sign in and add your team

1. Open your new link and sign in with the admin email/password from step 2.
2. Go to "Staff & dispatch partners" and create a login for each person —
   you set their email and a temporary password; tell them to change it later
   if you add that feature, or just share it with them directly for now.
3. Go to "Products" and add your product lines.
4. You're live. Share the link with your team.

## 5. (Optional) Point your own domain at it

In Vercel, go to your project > Settings > Domains, and add the domain you own
(bought from Namecheap, GoDaddy, etc.). Vercel will show you 1–2 DNS records to
add at your domain registrar. This step is entirely optional — the free
`.vercel.app` link works perfectly well without it.

---

### If something doesn't work
- Blank page after deploy → double check the three environment variables in Vercel
  are typed exactly right, then redeploy.
- Can't sign in → make sure the `profiles` row for your account has `role` set to
  exactly `admin` (lowercase, no extra spaces).
- "Only admins can create logins" → your own account's `profiles.role` isn't set
  to `admin` yet — recheck step 2.
