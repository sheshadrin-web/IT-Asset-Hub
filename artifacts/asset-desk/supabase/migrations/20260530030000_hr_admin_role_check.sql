-- Allow the hr_admin role on profiles.
-- Task #1 (Reporting Manager Transfer) introduced hr_admin in the app and RLS
-- policies, but the profiles_role_check CHECK constraint still only whitelisted
-- the original four roles, so saving a user as HR Admin failed with
-- "new row for relation 'profiles' violates check constraint 'profiles_role_check'".

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['super_admin'::text, 'it_admin'::text, 'hr_admin'::text, 'it_agent'::text, 'end_user'::text]));
