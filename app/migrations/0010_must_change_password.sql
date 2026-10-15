-- A password an admin (or the first-owner command) chose for someone is only good for getting in once: it must be changed at the first sign-in,
-- and a temporary one stops working after a while if it was never used.
alter table users add column must_change_password integer not null default 0;
alter table users add column password_expires_at text;
