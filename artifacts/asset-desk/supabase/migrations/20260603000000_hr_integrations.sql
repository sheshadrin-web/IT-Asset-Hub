-- ============================================================================
-- HR Portal Integrations + Onboarding/Offboarding + Asset Recovery (Phases 2-8)
-- ============================================================================
-- Architecture: Supabase-direct (no Express). All reads/writes for these tables
-- go through SECURITY DEFINER RPCs so credentials are NEVER exposed to the client
-- and role checks live in one place (mirrors the device-management RPCs).
--
-- Security model:
--   * hr_integrations.credentials_encrypted is NEVER returned to the client. There
--     is no SELECT grant on the table; the only read path is get_hr_integrations()
--     which strips secrets and returns a `credentials_set` boolean instead.
--     (In production, encrypt this column with pgcrypto/KMS; in this demo it holds
--     the raw config jsonb but is unreadable from the client.)
--   * Only super_admin may create/edit/delete integrations & rules & mappings.
--   * super_admin + it_admin may run syncs and act on recoveries.
--   * super_admin/it_admin/it_agent/hr_admin may read sync status & recovery queues.
--
-- Asset recovery reuses the existing assets.status value "Recovery Stage" (the
-- assets.status column has no CHECK constraint), so no enum migration is needed.
-- ============================================================================

-- ── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hr_integrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type         text NOT NULL,                       -- 'zoho' | 'keka' | 'custom'
  provider_name         text NOT NULL,
  status                text NOT NULL DEFAULT 'not_connected'
                          CHECK (status IN ('not_connected','connected','error')),
  api_base_url          text,
  credentials_encrypted jsonb,                               -- never returned to client
  auto_sync_enabled     boolean NOT NULL DEFAULT false,
  sync_frequency        text NOT NULL DEFAULT 'daily'
                          CHECK (sync_frequency IN ('hourly','daily','weekly')),
  last_sync_at          timestamptz,
  last_tested_at        timestamptz,
  last_error            text,
  created_by            uuid REFERENCES public.profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hr_integrations_provider_uniq
  ON public.hr_integrations(provider_type);

CREATE TABLE IF NOT EXISTS public.hr_sync_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id        uuid REFERENCES public.hr_integrations(id) ON DELETE SET NULL,
  provider_name         text,
  sync_status           text NOT NULL DEFAULT 'running'
                          CHECK (sync_status IN ('running','success','partial','failed')),
  started_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  employees_fetched     integer NOT NULL DEFAULT 0,
  users_created         integer NOT NULL DEFAULT 0,
  users_updated         integer NOT NULL DEFAULT 0,
  offboarding_detected  integer NOT NULL DEFAULT 0,
  errors_count          integer NOT NULL DEFAULT 0,
  error_message         text,
  raw_summary           jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_sync_logs_started_idx ON public.hr_sync_logs(started_at DESC);

CREATE TABLE IF NOT EXISTS public.employee_hr_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  hr_provider           text NOT NULL,
  hr_employee_id        text NOT NULL,
  employee_code         text,
  full_name             text,
  work_email            text,
  phone                 text,
  employment_status     text,                                -- active|joining|new|resigned|terminated|inactive|offboarding
  joining_date          date,
  resignation_date      date,
  last_working_date     date,
  department            text,
  designation           text,
  manager_name          text,
  manager_email         text,
  location              text,
  onboarding_done       boolean NOT NULL DEFAULT false,
  last_synced_at        timestamptz,
  raw_hr_data           jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_hr_profiles_uniq
  ON public.employee_hr_profiles(hr_provider, hr_employee_id);

CREATE TABLE IF NOT EXISTS public.asset_recovery (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id              uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  user_id               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  hr_profile_id         uuid REFERENCES public.employee_hr_profiles(id) ON DELETE SET NULL,
  recovery_status       text NOT NULL DEFAULT 'recovery_pending'
                          CHECK (recovery_status IN
                            ('recovery_pending','recovery_in_progress','recovered',
                             'not_reachable','escalated','lost')),
  recovery_reason       text,
  offboarding_date      date,
  last_working_date     date,
  recovery_started_at   timestamptz NOT NULL DEFAULT now(),
  recovered_at          timestamptz,
  last_seen_at          timestamptz,
  last_known_ip         text,
  last_known_location   text,
  signed_in_user        text,
  hostname              text,
  device_status         text,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_recovery_status_idx ON public.asset_recovery(recovery_status);
CREATE INDEX IF NOT EXISTS asset_recovery_asset_idx  ON public.asset_recovery(asset_id);
CREATE INDEX IF NOT EXISTS asset_recovery_hr_idx     ON public.asset_recovery(hr_profile_id);

CREATE TABLE IF NOT EXISTS public.integration_field_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id        uuid REFERENCES public.hr_integrations(id) ON DELETE CASCADE,
  source_field          text NOT NULL,
  target_field          text NOT NULL,
  is_required           boolean NOT NULL DEFAULT false,
  default_value         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_field_mappings_int_idx
  ON public.integration_field_mappings(integration_id);

CREATE TABLE IF NOT EXISTS public.automation_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key              text UNIQUE NOT NULL,                -- 'onboarding' | 'offboarding'
  rule_name             text NOT NULL,
  trigger_provider      text,
  trigger_event         text,
  conditions            jsonb NOT NULL DEFAULT '{}'::jsonb,
  actions               jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_enabled            boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action                text NOT NULL,
  entity_type           text,
  entity_id             uuid,
  description           text,
  metadata              jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON public.audit_logs(created_at DESC);

-- ── RLS: enable + deny direct access (all access via RPCs below) ──────────────
ALTER TABLE public.hr_integrations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_sync_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_hr_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_recovery            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_field_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs                ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies => no direct table access for clients.
-- SECURITY DEFINER functions below are the only entry points.

-- ── Helpers ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._hr_can_read()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_user_role() IN ('super_admin','it_admin','it_agent','hr_admin');
$$;

CREATE OR REPLACE FUNCTION public._hr_can_act()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT current_user_role() IN ('super_admin','it_admin');
$$;

CREATE OR REPLACE FUNCTION public._hr_audit(
  p_action text, p_entity_type text, p_entity_id uuid, p_desc text, p_meta jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.audit_logs (actor_user_id, action, entity_type, entity_id, description, metadata)
  VALUES (auth.uid(), p_action, p_entity_type, p_entity_id, p_desc, p_meta);
$$;

-- Safe JSON projection of an integration row (no credentials).
CREATE OR REPLACE FUNCTION public._hr_integration_json(r public.hr_integrations)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'provider_type', r.provider_type,
    'provider_name', r.provider_name,
    'status', r.status,
    'api_base_url', r.api_base_url,
    'auto_sync_enabled', r.auto_sync_enabled,
    'sync_frequency', r.sync_frequency,
    'last_sync_at', r.last_sync_at,
    'last_tested_at', r.last_tested_at,
    'last_error', r.last_error,
    'credentials_set', (r.credentials_encrypted IS NOT NULL),
    'updated_at', r.updated_at
  );
$$;

-- ── Integration RPCs (super_admin) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hr_integrations()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'forbidden: super_admin required'; END IF;
  SELECT COALESCE(jsonb_agg(public._hr_integration_json(r) ORDER BY r.provider_type), '[]'::jsonb)
    INTO v_out FROM public.hr_integrations r;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.save_hr_integration(
  p_provider_type text,
  p_provider_name text,
  p_api_base_url  text,
  p_credentials   jsonb,
  p_auto_sync     boolean,
  p_frequency     text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.hr_integrations;
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'forbidden: super_admin required'; END IF;
  IF p_frequency NOT IN ('hourly','daily','weekly') THEN p_frequency := 'daily'; END IF;

  INSERT INTO public.hr_integrations
    (provider_type, provider_name, api_base_url, credentials_encrypted,
     auto_sync_enabled, sync_frequency, status, last_error, created_by, updated_at)
  VALUES
    (p_provider_type, p_provider_name, p_api_base_url,
     CASE WHEN p_credentials IS NOT NULL AND p_credentials <> '{}'::jsonb THEN p_credentials ELSE NULL END,
     COALESCE(p_auto_sync, false), p_frequency, 'connected', NULL, auth.uid(), now())
  ON CONFLICT (provider_type) DO UPDATE SET
    provider_name         = EXCLUDED.provider_name,
    api_base_url          = EXCLUDED.api_base_url,
    -- keep existing secret if caller didn't re-send credentials
    credentials_encrypted = COALESCE(EXCLUDED.credentials_encrypted, public.hr_integrations.credentials_encrypted),
    auto_sync_enabled     = EXCLUDED.auto_sync_enabled,
    sync_frequency        = EXCLUDED.sync_frequency,
    status                = 'connected',
    last_error            = NULL,
    updated_at            = now()
  RETURNING * INTO v_row;

  PERFORM public._hr_audit('integration.save','hr_integration',v_row.id,
    'Saved '||v_row.provider_name||' integration', NULL);
  RETURN public._hr_integration_json(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.disconnect_hr_integration(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.hr_integrations;
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'forbidden: super_admin required'; END IF;
  UPDATE public.hr_integrations
     SET status='not_connected', credentials_encrypted=NULL, auto_sync_enabled=false, updated_at=now()
   WHERE id = p_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration not found'; END IF;
  PERFORM public._hr_audit('integration.disconnect','hr_integration',v_row.id,
    'Disconnected '||v_row.provider_name, NULL);
  RETURN public._hr_integration_json(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.delete_hr_integration(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_name text;
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'forbidden: super_admin required'; END IF;
  SELECT provider_name INTO v_name FROM public.hr_integrations WHERE id = p_id;
  DELETE FROM public.hr_integrations WHERE id = p_id;
  PERFORM public._hr_audit('integration.delete','hr_integration',p_id,
    'Deleted '||COALESCE(v_name,'integration'), NULL);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.test_hr_integration(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.hr_integrations; v_ok boolean;
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'forbidden: super_admin required'; END IF;
  SELECT * INTO v_row FROM public.hr_integrations WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration not found'; END IF;
  v_ok := v_row.credentials_encrypted IS NOT NULL;
  UPDATE public.hr_integrations
     SET last_tested_at = now(),
         status = CASE WHEN v_ok THEN 'connected' ELSE 'error' END,
         last_error = CASE WHEN v_ok THEN NULL ELSE 'No credentials configured' END,
         updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object(
    'ok', v_ok,
    'message', CASE WHEN v_ok
      THEN 'Connection looks good. (Demo mode: credentials present; live API verification runs once real keys are used.)'
      ELSE 'No credentials configured. Save credentials before testing.' END
  );
END $$;

-- ── HR sync (demo / mock employee data) ──────────────────────────────────────
-- Generates a deterministic set of demo employees, upserts employee_hr_profiles,
-- and runs offboarding automation (asset recovery). Does NOT mint real auth/login
-- users (unsafe on a live DB); new joiners surface in the Onboarding Queue.
CREATE OR REPLACE FUNCTION public.run_hr_sync(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_int public.hr_integrations;
  v_log_id uuid;
  v_emps jsonb;
  v_emp jsonb;
  v_provider text;
  v_existing public.employee_hr_profiles;
  v_profile_id uuid;
  v_user_id uuid;
  v_status text;
  v_is_off boolean;
  v_fetched int := 0; v_created int := 0; v_updated int := 0; v_off int := 0; v_errors int := 0;
BEGIN
  IF NOT public._hr_can_act() THEN RAISE EXCEPTION 'forbidden: super_admin or it_admin required'; END IF;
  SELECT * INTO v_int FROM public.hr_integrations WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration not found'; END IF;
  IF v_int.credentials_encrypted IS NULL THEN
    RAISE EXCEPTION 'integration not configured: save credentials before syncing';
  END IF;
  v_provider := v_int.provider_type;

  INSERT INTO public.hr_sync_logs (integration_id, provider_name, sync_status, started_at)
  VALUES (p_id, v_int.provider_name, 'running', now()) RETURNING id INTO v_log_id;

  -- Deterministic demo dataset. Demo emails use @demo-hr.miles so they never
  -- collide with real profiles (so a sync never mutates real users/assets unless
  -- an admin deliberately wires a matching email).
  v_emps := '[
    {"code":"MIL-2041","name":"Aarav Sharma","email":"aarav.sharma@demo-hr.miles","dept":"Finance","desig":"Financial Analyst","mgr":"Priya Nair","mgr_email":"priya.nair@mileseducation.com","loc":"Hyderabad","status":"active","joining":"2026-05-20"},
    {"code":"MIL-2042","name":"Diya Patel","email":"diya.patel@demo-hr.miles","dept":"Marketing","desig":"Content Lead","mgr":"Rahul Verma","mgr_email":"rahul.verma@mileseducation.com","loc":"Bengaluru","status":"joining","joining":"2026-06-01"},
    {"code":"MIL-2043","name":"Kabir Singh","email":"kabir.singh@demo-hr.miles","dept":"Engineering","desig":"Backend Engineer","mgr":"Sneha Iyer","mgr_email":"sneha.iyer@mileseducation.com","loc":"Hyderabad","status":"active","joining":"2026-04-12"},
    {"code":"MIL-2044","name":"Anaya Reddy","email":"anaya.reddy@demo-hr.miles","dept":"Sales","desig":"Sales Executive","mgr":"Vikram Joshi","mgr_email":"vikram.joshi@mileseducation.com","loc":"Chennai","status":"joining","joining":"2026-06-02"},
    {"code":"MIL-2050","name":"Rohan Mehta","email":"rohan.mehta@demo-hr.miles","dept":"Operations","desig":"Ops Manager","mgr":"Priya Nair","mgr_email":"priya.nair@mileseducation.com","loc":"Hyderabad","status":"resigned","joining":"2024-01-10","resignation":"2026-05-15","lwd":"2026-05-31","device":"MEL-LT-2050"},
    {"code":"MIL-2051","name":"Ishita Rao","email":"ishita.rao@demo-hr.miles","dept":"Support","desig":"Support Engineer","mgr":"Sneha Iyer","mgr_email":"sneha.iyer@mileseducation.com","loc":"Bengaluru","status":"terminated","joining":"2023-07-22","lwd":"2026-05-28","device":"MEL-LT-2051"}
  ]'::jsonb;

  FOR v_emp IN SELECT * FROM jsonb_array_elements(v_emps) LOOP
    v_fetched := v_fetched + 1;
    v_status := v_emp->>'status';
    v_is_off := v_status IN ('resigned','terminated','inactive','offboarding') OR (v_emp ? 'lwd');

    -- Demo sync is strictly isolated: it never links to or mutates real
    -- profiles. Demo employees live only in employee_hr_profiles.
    v_user_id := NULL;

    SELECT * INTO v_existing FROM public.employee_hr_profiles
      WHERE hr_provider = v_provider AND hr_employee_id = (v_emp->>'code');

    INSERT INTO public.employee_hr_profiles (
      user_id, hr_provider, hr_employee_id, employee_code, full_name, work_email,
      employment_status, joining_date, resignation_date, last_working_date,
      department, designation, manager_name, manager_email, location,
      onboarding_done, last_synced_at, raw_hr_data, updated_at
    ) VALUES (
      v_user_id, v_provider, v_emp->>'code', v_emp->>'code', v_emp->>'name', v_emp->>'email',
      v_status, NULLIF(v_emp->>'joining','')::date, NULLIF(v_emp->>'resignation','')::date,
      NULLIF(v_emp->>'lwd','')::date, v_emp->>'dept', v_emp->>'desig', v_emp->>'mgr',
      v_emp->>'mgr_email', v_emp->>'loc',
      COALESCE(v_existing.onboarding_done, false), now(), v_emp, now()
    )
    ON CONFLICT (hr_provider, hr_employee_id) DO UPDATE SET
      employment_status = EXCLUDED.employment_status,
      resignation_date  = EXCLUDED.resignation_date,
      last_working_date = EXCLUDED.last_working_date,
      department        = EXCLUDED.department,
      designation       = EXCLUDED.designation,
      manager_name      = EXCLUDED.manager_name,
      manager_email     = EXCLUDED.manager_email,
      location          = EXCLUDED.location,
      user_id           = COALESCE(EXCLUDED.user_id, public.employee_hr_profiles.user_id),
      last_synced_at    = now(),
      raw_hr_data       = EXCLUDED.raw_hr_data,
      updated_at        = now()
    RETURNING id INTO v_profile_id;

    IF v_existing.id IS NULL THEN v_created := v_created + 1; ELSE v_updated := v_updated + 1; END IF;

    -- Offboarding automation → standalone demo recovery record. Demo mode never
    -- touches real assets/users; it creates an isolated recovery row with demo
    -- device telemetry so the recovery queue is meaningful.
    IF v_is_off THEN
      v_off := v_off + 1;
      IF NOT EXISTS (
        SELECT 1 FROM public.asset_recovery r
        WHERE r.hr_profile_id = v_profile_id AND r.recovery_status <> 'recovered'
      ) THEN
        INSERT INTO public.asset_recovery (
          asset_id, user_id, hr_profile_id, recovery_status, recovery_reason,
          offboarding_date, last_working_date, recovery_started_at,
          last_seen_at, last_known_ip, last_known_location, signed_in_user,
          hostname, device_status
        ) VALUES (
          NULL, NULL, v_profile_id, 'recovery_pending',
          'HR offboarding detected from '||v_int.provider_name,
          NULLIF(v_emp->>'resignation','')::date, NULLIF(v_emp->>'lwd','')::date, now(),
          now() - (interval '1 day' * (2 + v_off)),
          '10.20.' || (v_off+10)::text || '.' || (v_fetched*7 % 250)::text,
          'Approximate (network/IP-based)', v_emp->>'email',
          COALESCE(v_emp->>'device','UNREGISTERED-DEVICE'), 'offline'
        );
        PERFORM public._hr_audit('asset.recovery_mode','employee_hr_profile',v_profile_id,
          'Recovery record created for offboarding employee (demo, no managed asset linked).',
          jsonb_build_object('employee', v_emp->>'name', 'provider', v_int.provider_name));
      END IF;
    END IF;
  END LOOP;

  UPDATE public.hr_sync_logs SET
    sync_status='success', completed_at=now(),
    employees_fetched=v_fetched, users_created=v_created, users_updated=v_updated,
    offboarding_detected=v_off, errors_count=v_errors,
    raw_summary=jsonb_build_object('fetched',v_fetched,'created',v_created,'updated',v_updated,'offboarding',v_off)
  WHERE id = v_log_id;

  UPDATE public.hr_integrations SET last_sync_at=now(), status='connected', last_error=NULL, updated_at=now()
   WHERE id = p_id;

  PERFORM public._hr_audit('integration.sync','hr_integration',p_id,
    'Ran HR sync for '||v_int.provider_name,
    jsonb_build_object('fetched',v_fetched,'offboarding',v_off));

  RETURN jsonb_build_object(
    'ok', true, 'log_id', v_log_id, 'employees_fetched', v_fetched,
    'users_created', v_created, 'users_updated', v_updated,
    'offboarding_detected', v_off, 'errors', v_errors
  );
END $$;

CREATE OR REPLACE FUNCTION public.get_hr_sync_logs(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.started_at DESC), '[]'::jsonb)
    INTO v_out
    FROM (SELECT * FROM public.hr_sync_logs ORDER BY started_at DESC LIMIT GREATEST(p_limit,1)) l;
  RETURN v_out;
END $$;

-- ── Onboarding / Offboarding queues ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_onboarding_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.joining_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_out FROM public.employee_hr_profiles p
   WHERE p.employment_status IN ('active','joining','new')
     AND p.resignation_date IS NULL AND p.last_working_date IS NULL
     AND p.onboarding_done = false;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.get_offboarding_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.last_working_date DESC NULLS LAST), '[]'::jsonb)
    INTO v_out FROM public.employee_hr_profiles p
   WHERE p.employment_status IN ('resigned','terminated','inactive','offboarding')
      OR p.last_working_date IS NOT NULL;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.mark_onboarding_done(p_profile_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._hr_can_act() THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.employee_hr_profiles SET onboarding_done=true, updated_at=now() WHERE id=p_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile not found'; END IF;
  PERFORM public._hr_audit('onboarding.complete','employee_hr_profile',p_profile_id,'Onboarding marked complete',NULL);
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── Recovery queue + actions ─────────────────────────────────────────────────
-- Enriched single recovery row (matches the RecoveryRow client shape). Used by
-- the action RPCs and the asset-detail banner so every recovery payload is
-- consistent. Not granted to clients — only definer-context callers use it.
CREATE OR REPLACE FUNCTION public._recovery_row_json(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'id', r.id,
    'recovery_status', r.recovery_status,
    'recovery_reason', r.recovery_reason,
    'offboarding_date', r.offboarding_date,
    'last_working_date', r.last_working_date,
    'recovery_started_at', r.recovery_started_at,
    'recovered_at', r.recovered_at,
    'last_seen_at', r.last_seen_at,
    'last_known_ip', r.last_known_ip,
    'last_known_location', r.last_known_location,
    'signed_in_user', r.signed_in_user,
    'hostname', r.hostname,
    'device_status', r.device_status,
    'notes', r.notes,
    'asset_id', r.asset_id,
    'asset_tag', a.asset_id,
    'asset_model', a.model,
    'asset_type', a.asset_type,
    'employee_name', COALESCE(hp.full_name, p.full_name),
    'employee_code', COALESCE(hp.employee_code, p.ecode),
    'department', COALESCE(hp.department, p.department),
    'manager_name', hp.manager_name,
    'manager_email', hp.manager_email
  )
  FROM public.asset_recovery r
  LEFT JOIN public.assets a ON a.id = r.asset_id
  LEFT JOIN public.employee_hr_profiles hp ON hp.id = r.hr_profile_id
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE r.id = p_id;
$$;
REVOKE ALL ON FUNCTION public._recovery_row_json(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_recovery_assets(p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'priority')::int, (row->>'recovery_started_at')), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'id', r.id,
      'recovery_status', r.recovery_status,
      'recovery_reason', r.recovery_reason,
      'offboarding_date', r.offboarding_date,
      'last_working_date', r.last_working_date,
      'recovery_started_at', r.recovery_started_at,
      'recovered_at', r.recovered_at,
      'last_seen_at', r.last_seen_at,
      'last_known_ip', r.last_known_ip,
      'last_known_location', r.last_known_location,
      'signed_in_user', r.signed_in_user,
      'hostname', r.hostname,
      'device_status', r.device_status,
      'notes', r.notes,
      'asset_id', r.asset_id,
      'asset_tag', a.asset_id,
      'asset_model', a.model,
      'asset_type', a.asset_type,
      'employee_name', COALESCE(hp.full_name, p.full_name),
      'employee_code', COALESCE(hp.employee_code, p.ecode),
      'department', COALESCE(hp.department, p.department),
      'manager_name', hp.manager_name,
      'manager_email', hp.manager_email,
      'priority', CASE r.recovery_status
        WHEN 'recovery_pending' THEN 0 WHEN 'recovery_in_progress' THEN 1
        WHEN 'not_reachable' THEN 2 WHEN 'escalated' THEN 3
        WHEN 'lost' THEN 4 ELSE 5 END
    ) AS row, r.recovery_started_at
    FROM public.asset_recovery r
    LEFT JOIN public.assets a ON a.id = r.asset_id
    LEFT JOIN public.employee_hr_profiles hp ON hp.id = r.hr_profile_id
    LEFT JOIN public.profiles p ON p.id = r.user_id
    WHERE (p_status IS NULL OR r.recovery_status = p_status)
  ) q;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.recovery_locate(p_recovery_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.asset_recovery; d RECORD;
BEGIN
  IF NOT public._hr_can_act() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO r FROM public.asset_recovery WHERE id = p_recovery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'recovery record not found'; END IF;

  IF r.asset_id IS NOT NULL THEN
    SELECT last_seen_at, ip_address, hostname, logged_in_username, status
      INTO d FROM public.managed_devices WHERE laptop_asset_id = r.asset_id
      ORDER BY last_seen_at DESC NULLS LAST LIMIT 1;
    IF FOUND THEN
      UPDATE public.asset_recovery SET
        last_seen_at = d.last_seen_at,
        last_known_ip = d.ip_address,
        last_known_location = CASE WHEN d.ip_address IS NOT NULL
          THEN 'Approximate (network/IP-based)' ELSE 'Location unavailable' END,
        signed_in_user = COALESCE(d.logged_in_username, signed_in_user),
        hostname = COALESCE(d.hostname, hostname),
        device_status = COALESCE(d.status, device_status),
        recovery_status = CASE WHEN recovery_status='recovery_pending'
          THEN 'recovery_in_progress' ELSE recovery_status END,
        updated_at = now()
      WHERE id = p_recovery_id RETURNING * INTO r;
    ELSE
      UPDATE public.asset_recovery SET
        last_known_location = COALESCE(last_known_location,'Location unavailable'),
        recovery_status = CASE WHEN recovery_status='recovery_pending'
          THEN 'recovery_in_progress' ELSE recovery_status END,
        updated_at = now()
      WHERE id = p_recovery_id RETURNING * INTO r;
    END IF;
  ELSE
    -- demo row: just advance status and refresh timestamp
    UPDATE public.asset_recovery SET
      recovery_status = CASE WHEN recovery_status='recovery_pending'
        THEN 'recovery_in_progress' ELSE recovery_status END,
      updated_at = now()
    WHERE id = p_recovery_id RETURNING * INTO r;
  END IF;

  PERFORM public._hr_audit('recovery.locate','asset_recovery',p_recovery_id,'Located device for recovery',NULL);
  RETURN public._recovery_row_json(p_recovery_id);
END $$;

CREATE OR REPLACE FUNCTION public.recovery_update_status(p_recovery_id uuid, p_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.asset_recovery;
BEGIN
  IF NOT public._hr_can_act() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_status NOT IN ('recovery_pending','recovery_in_progress','recovered','not_reachable','escalated','lost') THEN
    RAISE EXCEPTION 'invalid recovery status: %', p_status;
  END IF;

  UPDATE public.asset_recovery SET
    recovery_status = p_status,
    recovered_at = CASE WHEN p_status='recovered' THEN now() ELSE recovered_at END,
    updated_at = now()
  WHERE id = p_recovery_id RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'recovery record not found'; END IF;

  -- Reflect terminal states onto the asset
  IF r.asset_id IS NOT NULL THEN
    IF p_status = 'recovered' THEN
      UPDATE public.assets SET status='Available', assigned_to=NULL, assigned_email=NULL,
             assigned_to_name=NULL WHERE id = r.asset_id;
    ELSIF p_status = 'lost' THEN
      UPDATE public.assets SET status='Lost' WHERE id = r.asset_id;
    END IF;
  END IF;

  PERFORM public._hr_audit('recovery.status','asset_recovery',p_recovery_id,
    'Recovery status set to '||p_status, jsonb_build_object('status',p_status));
  RETURN public._recovery_row_json(p_recovery_id);
END $$;

CREATE OR REPLACE FUNCTION public.recovery_mark_recovered(p_recovery_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.recovery_update_status(p_recovery_id, 'recovered');
END $$;

CREATE OR REPLACE FUNCTION public.recovery_notify(p_recovery_id uuid, p_target text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.asset_recovery; v_to text;
BEGIN
  IF NOT public._hr_can_act() THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_target NOT IN ('employee','manager') THEN RAISE EXCEPTION 'invalid notify target'; END IF;
  SELECT * INTO r FROM public.asset_recovery WHERE id = p_recovery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'recovery record not found'; END IF;

  IF p_target='employee' THEN v_to := r.signed_in_user;
  ELSE SELECT manager_email INTO v_to FROM public.employee_hr_profiles WHERE id = r.hr_profile_id; END IF;

  PERFORM public._hr_audit('recovery.notify','asset_recovery',p_recovery_id,
    'Notification queued to '||p_target, jsonb_build_object('target',p_target,'to',v_to));
  RETURN jsonb_build_object('ok', true, 'target', p_target, 'to', COALESCE(v_to,'(no address on file)'),
    'message', 'Notification recorded. (Demo mode: email delivery is enabled once SMTP/email function is wired.)');
END $$;

-- Recovery details for a single asset (asset detail page banner).
CREATE OR REPLACE FUNCTION public.get_asset_recovery(p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT r.id INTO v_id
  FROM public.asset_recovery r
  WHERE r.asset_id = p_asset_id AND r.recovery_status <> 'recovered'
  ORDER BY r.recovery_started_at DESC LIMIT 1;
  IF v_id IS NULL THEN RETURN NULL; END IF;  -- not in recovery
  RETURN public._recovery_row_json(v_id);
END $$;

-- ── Field mapping (super_admin) ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_field_mapping(p_integration_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'forbidden: super_admin required'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'source_field', source_field, 'target_field', target_field,
    'is_required', is_required, 'default_value', default_value) ORDER BY created_at), '[]'::jsonb)
    INTO v_out FROM public.integration_field_mappings WHERE integration_id = p_integration_id;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.save_field_mapping(p_integration_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row jsonb;
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'forbidden: super_admin required'; END IF;
  DELETE FROM public.integration_field_mappings WHERE integration_id = p_integration_id;
  FOR row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) LOOP
    INSERT INTO public.integration_field_mappings
      (integration_id, source_field, target_field, is_required, default_value)
    VALUES (p_integration_id, row->>'source_field', row->>'target_field',
      COALESCE((row->>'is_required')::boolean,false), row->>'default_value');
  END LOOP;
  PERFORM public._hr_audit('field_mapping.save','hr_integration',p_integration_id,'Saved field mapping',NULL);
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── Automation rules (super_admin write, admins read) ────────────────────────
CREATE OR REPLACE FUNCTION public.get_automation_rules()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'rule_key', rule_key, 'rule_name', rule_name, 'is_enabled', is_enabled,
    'actions', actions, 'conditions', conditions) ORDER BY rule_key), '[]'::jsonb)
    INTO v_out FROM public.automation_rules;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.save_automation_rules(p_rules jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row jsonb;
BEGIN
  IF NOT public._is_super_admin() THEN RAISE EXCEPTION 'forbidden: super_admin required'; END IF;
  FOR row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rules,'[]'::jsonb)) LOOP
    INSERT INTO public.automation_rules (rule_key, rule_name, actions, is_enabled, updated_at)
    VALUES (row->>'rule_key', COALESCE(row->>'rule_name', row->>'rule_key'),
      COALESCE(row->'actions','{}'::jsonb), COALESCE((row->>'is_enabled')::boolean, true), now())
    ON CONFLICT (rule_key) DO UPDATE SET
      rule_name = EXCLUDED.rule_name, actions = EXCLUDED.actions,
      is_enabled = EXCLUDED.is_enabled, updated_at = now();
  END LOOP;
  PERFORM public._hr_audit('automation_rules.save',NULL,NULL,'Saved automation rules',NULL);
  RETURN jsonb_build_object('ok', true);
END $$;

-- ── Dashboard summary ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hr_dashboard_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'integrations_connected', (SELECT count(*) FROM public.hr_integrations WHERE status='connected'),
    'onboarding_pending', (SELECT count(*) FROM public.employee_hr_profiles
        WHERE employment_status IN ('active','joining','new')
          AND resignation_date IS NULL AND last_working_date IS NULL AND onboarding_done=false),
    'offboarding_started', (SELECT count(*) FROM public.employee_hr_profiles
        WHERE employment_status IN ('resigned','terminated','inactive','offboarding')
           OR last_working_date IS NOT NULL),
    'assets_in_recovery', (SELECT count(*) FROM public.asset_recovery
        WHERE recovery_status IN ('recovery_pending','recovery_in_progress','not_reachable','escalated')),
    'devices_not_seen_recently', (SELECT count(*) FROM public.asset_recovery
        WHERE recovery_status <> 'recovered'
          AND (last_seen_at IS NULL OR last_seen_at < now() - interval '7 days')),
    'recovery_overdue', (SELECT count(*) FROM public.asset_recovery
        WHERE recovery_status IN ('recovery_pending','recovery_in_progress','not_reachable','escalated')
          AND recovery_started_at < now() - interval '7 days')
  ) INTO v;
  RETURN v;
END $$;

-- ── Grants (execute only; role checks enforced inside each function) ──────────
GRANT EXECUTE ON FUNCTION public.get_hr_integrations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_hr_integration(text,text,text,jsonb,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.disconnect_hr_integration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_hr_integration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.test_hr_integration(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_hr_sync(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hr_sync_logs(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_onboarding_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_offboarding_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_done(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recovery_assets(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recovery_locate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recovery_update_status(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recovery_mark_recovered(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recovery_notify(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_asset_recovery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_field_mapping(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_field_mapping(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_automation_rules() TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_automation_rules(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_hr_dashboard_summary() TO authenticated;
