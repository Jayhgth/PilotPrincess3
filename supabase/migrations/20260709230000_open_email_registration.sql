-- Product scope now permits registration with any valid email address.
-- Keep the domain table as an optional future policy mechanism, but remove
-- enforcement from auth.users so existing and new domains behave equally.

drop trigger if exists enforce_allowed_email_domain_before_signup on auth.users;
drop function if exists public.enforce_allowed_email_domain();

comment on table public.allowed_email_domains is
  'Optional domain metadata retained for future enrollment policies; not enforced for registration.';
