-- ============================================================================
-- HR Direct User Sync + Exit-based Asset Recovery (replaces onboarding/offboarding queues)
-- ============================================================================
-- New product flow (no onboarding/offboarding approval queues):
--   * HR portal employee  -> create/update a REAL user in public.profiles
--   * HR exit status       -> deactivate that user (status='inactive') AND move every
--                             asset assigned to them into Recovery Mode
--                             (assets.status='Recovery Stage' + asset_recovery row).
--
-- profiles has NO FK to auth.users, so HR-synced employees are inserted directly as
-- profile rows (role='end_user'); they appear in the Users module immediately.
--
-- Demo/mock sync stays self-contained: demo users use @demo-hr.miles emails and demo
-- assets use the MEL-LT-* tags from the mock dataset, so the REAL code path is exercised
-- without ever touching genuine employees or genuine assets.
-- ============================================================================

-- ── Schema additions ─────────────────────────────────────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone             text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS designation       text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS joining_date      date;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS employment_status text;   -- HR status: active|resigned|terminated|inactive
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hr_source         text;   -- e.g. 'Zoho People'
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS hr_employee_id    text;   -- HR provider employee id (match key)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_hr_sync_at   timestamptz;

CREATE INDEX IF NOT EXISTS profiles_hr_employee_id_idx ON public.profiles(hr_employee_id) WHERE hr_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_hr_source_idx      ON public.profiles(hr_source)      WHERE hr_source IS NOT NULL;

ALTER TABLE public.hr_sync_logs ADD COLUMN IF NOT EXISTS users_deactivated integer NOT NULL DEFAULT 0;
ALTER TABLE public.hr_sync_logs ADD COLUMN IF NOT EXISTS assets_recovered  integer NOT NULL DEFAULT 0;

-- Idempotency key for the HR mirror so re-syncs update instead of duplicating.
DO $$ BEGIN
  ALTER TABLE public.employee_hr_profiles
    ADD CONSTRAINT employee_hr_profiles_provider_emp_uq UNIQUE (hr_provider, hr_employee_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- ── Helper: move all assets assigned to a user into Recovery Mode ─────────────
-- Returns the number of assets newly moved into recovery. Idempotent: assets already
-- in 'Recovery Stage'/'Lost' are skipped, and an asset with an active recovery row is
-- not duplicated. Pulls live device telemetry from managed_devices when available.
CREATE OR REPLACE FUNCTION public._recover_user_assets(
  p_user_id uuid, p_hr_profile_id uuid, p_reason text, p_off date, p_lwd date
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a RECORD; d RECORD; v_count int := 0;
BEGIN
  IF p_user_id IS NULL THEN RETURN 0; END IF;

  FOR a IN
    SELECT * FROM public.assets
     WHERE assigned_to = p_user_id
       AND status NOT IN ('Recovery Stage','Lost')
  LOOP
    UPDATE public.assets SET status='Recovery Stage', updated_at=now() WHERE id = a.id;

    IF EXISTS (SELECT 1 FROM public.asset_recovery r
                WHERE r.asset_id = a.id AND r.recovery_status <> 'recovered') THEN
      CONTINUE;
    END IF;

    SELECT last_seen_at, ip_address, hostname, logged_in_username, status
      INTO d FROM public.managed_devices WHERE laptop_asset_id = a.id
      ORDER BY last_seen_at DESC NULLS LAST LIMIT 1;

    INSERT INTO public.asset_recovery (
      asset_id, user_id, hr_profile_id, recovery_status, recovery_reason,
      offboarding_date, last_working_date, recovery_started_at,
      last_seen_at, last_known_ip, last_known_location, signed_in_user, hostname, device_status
    ) VALUES (
      a.id, p_user_id, p_hr_profile_id, 'recovery_pending', p_reason,
      p_off, p_lwd, now(),
      d.last_seen_at, d.ip_address,
      CASE WHEN d.ip_address IS NOT NULL THEN 'Approximate (network/IP-based)' ELSE NULL END,
      COALESCE(d.logged_in_username, a.assigned_email), d.hostname, COALESCE(d.status,'unknown')
    );

    v_count := v_count + 1;
    PERFORM public._hr_audit('asset.recovery_mode','asset',a.id,
      'Asset moved to Recovery Mode because assigned employee exited in HR portal.',
      jsonb_build_object('asset_tag', a.asset_id, 'reason', p_reason));
  END LOOP;

  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public._recover_user_assets(uuid,uuid,text,date,date) FROM PUBLIC;

-- ── HR sync (demo / mock): direct user sync + exit-based recovery ─────────────
-- Upserts REAL profiles (match by hr_employee_id then email; never duplicates),
-- links employee_hr_profiles.user_id to the created user, deactivates exited users,
-- and moves their assigned assets into recovery. Demo exit employees get a demo
-- laptop assigned so the recovery path is visible end-to-end.
CREATE OR REPLACE FUNCTION public.run_hr_sync(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_int       public.hr_integrations;
  v_log_id    uuid;
  v_emps      jsonb;
  v_emp       jsonb;
  v_provider  text;
  v_src       text;
  v_user_id   uuid;
  v_profile_id uuid;
  v_status    text;
  v_app_status text;
  v_is_exit   boolean;
  v_existed   boolean;
  v_device    text;
  v_asset_id  uuid;
  v_fetched int := 0; v_created int := 0; v_updated int := 0;
  v_deact int := 0; v_recovered int := 0; v_errors int := 0;
BEGIN
  IF NOT public._hr_can_act() THEN RAISE EXCEPTION 'forbidden: super_admin or it_admin required'; END IF;
  SELECT * INTO v_int FROM public.hr_integrations WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'integration not found'; END IF;
  IF v_int.credentials_encrypted IS NULL THEN
    RAISE EXCEPTION 'integration not configured: save credentials before syncing';
  END IF;
  v_provider := v_int.provider_type;
  v_src      := v_int.provider_name;

  INSERT INTO public.hr_sync_logs (integration_id, provider_name, sync_status, started_at)
  VALUES (p_id, v_int.provider_name, 'running', now()) RETURNING id INTO v_log_id;

  -- Deterministic mock employee feed. Demo emails (@demo-hr.miles) + demo laptop tags
  -- keep the sync self-contained; the SAME code path runs for real HR data.
  v_emps := '[
    {"code":"MIL-2041","name":"Aarav Sharma","email":"aarav.sharma@demo-hr.miles","phone":"+91 90000 12041","dept":"Finance","desig":"Financial Analyst","mgr":"Priya Nair","mgr_email":"priya.nair@mileseducation.com","loc":"Hyderabad","status":"active","joining":"2026-05-20"},
    {"code":"MIL-2042","name":"Diya Patel","email":"diya.patel@demo-hr.miles","phone":"+91 90000 12042","dept":"Marketing","desig":"Content Lead","mgr":"Rahul Verma","mgr_email":"rahul.verma@mileseducation.com","loc":"Bengaluru","status":"active","joining":"2026-06-01"},
    {"code":"MIL-2043","name":"Kabir Singh","email":"kabir.singh@demo-hr.miles","phone":"+91 90000 12043","dept":"Engineering","desig":"Backend Engineer","mgr":"Sneha Iyer","mgr_email":"sneha.iyer@mileseducation.com","loc":"Hyderabad","status":"active","joining":"2026-04-12"},
    {"code":"MIL-2044","name":"Anaya Reddy","email":"anaya.reddy@demo-hr.miles","phone":"+91 90000 12044","dept":"Sales","desig":"Sales Executive","mgr":"Vikram Joshi","mgr_email":"vikram.joshi@mileseducation.com","loc":"Chennai","status":"active","joining":"2026-06-02"},
    {"code":"MIL-2050","name":"Rohan Mehta","email":"rohan.mehta@demo-hr.miles","phone":"+91 90000 12050","dept":"Operations","desig":"Ops Manager","mgr":"Priya Nair","mgr_email":"priya.nair@mileseducation.com","loc":"Hyderabad","status":"resigned","joining":"2024-01-10","resignation":"2026-05-15","lwd":"2026-05-31","device":"MEL-LT-2050"},
    {"code":"MIL-2051","name":"Ishita Rao","email":"ishita.rao@demo-hr.miles","phone":"+91 90000 12051","dept":"Support","desig":"Support Engineer","mgr":"Sneha Iyer","mgr_email":"sneha.iyer@mileseducation.com","loc":"Bengaluru","status":"terminated","joining":"2023-07-22","lwd":"2026-05-28","device":"MEL-LT-2051"}
  ]'::jsonb;

  FOR v_emp IN SELECT * FROM jsonb_array_elements(v_emps) LOOP
    v_fetched := v_fetched + 1;
    v_status  := lower(v_emp->>'status');
    v_is_exit := v_status IN ('resigned','terminated','inactive','exit','relieved','offboarding')
                 OR (v_emp ? 'lwd');
    v_app_status := CASE WHEN v_is_exit THEN 'inactive' ELSE 'active' END;

    -- 1) Match an existing user: hr_employee_id first, then official email.
    v_user_id := NULL;
    SELECT id INTO v_user_id FROM public.profiles
      WHERE hr_employee_id = (v_emp->>'code') LIMIT 1;
    IF v_user_id IS NULL THEN
      SELECT id INTO v_user_id FROM public.profiles
        WHERE lower(email) = lower(v_emp->>'email') LIMIT 1;
    END IF;
    v_existed := v_user_id IS NOT NULL;

    -- 2) Create or update the real user.
    IF v_existed THEN
      UPDATE public.profiles SET
        full_name         = COALESCE(v_emp->>'name', full_name),
        department        = v_emp->>'dept',
        designation       = v_emp->>'desig',
        reporting_manager = COALESCE(v_emp->>'mgr', reporting_manager),
        location          = v_emp->>'loc',
        phone             = v_emp->>'phone',
        joining_date      = NULLIF(v_emp->>'joining','')::date,
        employment_status = v_status,
        hr_source         = v_src,
        hr_employee_id    = v_emp->>'code',
        status            = v_app_status,
        last_hr_sync_at   = now(),
        updated_at        = now()
      WHERE id = v_user_id;
      v_updated := v_updated + 1;
    ELSE
      -- profiles.id has a FK to auth.users, so the auth record must exist first.
      -- The handle_new_user trigger cannot create the profile (its status='Active'
      -- violates profiles_status_check), so we upsert the full profile ourselves.
      v_user_id := gen_random_uuid();
      INSERT INTO auth.users (
        id, instance_id, aud, role, email, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      ) VALUES (
        v_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        v_emp->>'email', now(),
        jsonb_build_object('provider','hr_sync','providers', jsonb_build_array('hr_sync')),
        jsonb_build_object('full_name', v_emp->>'name', 'role','end_user',
                           'department', v_emp->>'dept', 'location', v_emp->>'loc'),
        now(), now()
      );
      INSERT INTO public.profiles (
        id, full_name, email, role, status, ecode, reporting_manager,
        department, location, phone, designation, joining_date,
        employment_status, hr_source, hr_employee_id, last_hr_sync_at, created_at, updated_at
      ) VALUES (
        v_user_id, v_emp->>'name', v_emp->>'email', 'end_user', v_app_status,
        v_emp->>'code', COALESCE(v_emp->>'mgr','—'),
        v_emp->>'dept', v_emp->>'loc', v_emp->>'phone', v_emp->>'desig',
        NULLIF(v_emp->>'joining','')::date, v_status, v_src, v_emp->>'code', now(), now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET
        full_name=EXCLUDED.full_name, role=EXCLUDED.role, status=EXCLUDED.status,
        ecode=EXCLUDED.ecode, reporting_manager=EXCLUDED.reporting_manager,
        department=EXCLUDED.department, location=EXCLUDED.location, phone=EXCLUDED.phone,
        designation=EXCLUDED.designation, joining_date=EXCLUDED.joining_date,
        employment_status=EXCLUDED.employment_status, hr_source=EXCLUDED.hr_source,
        hr_employee_id=EXCLUDED.hr_employee_id, last_hr_sync_at=EXCLUDED.last_hr_sync_at,
        updated_at=now();
      v_created := v_created + 1;
    END IF;

    -- 3) Mirror into employee_hr_profiles, linked to the real user.
    INSERT INTO public.employee_hr_profiles (
      user_id, hr_provider, hr_employee_id, employee_code, full_name, work_email, phone,
      employment_status, joining_date, resignation_date, last_working_date,
      department, designation, manager_name, manager_email, location,
      onboarding_done, last_synced_at, raw_hr_data, updated_at
    ) VALUES (
      v_user_id, v_provider, v_emp->>'code', v_emp->>'code', v_emp->>'name', v_emp->>'email', v_emp->>'phone',
      v_status, NULLIF(v_emp->>'joining','')::date, NULLIF(v_emp->>'resignation','')::date,
      NULLIF(v_emp->>'lwd','')::date, v_emp->>'dept', v_emp->>'desig', v_emp->>'mgr',
      v_emp->>'mgr_email', v_emp->>'loc', true, now(), v_emp, now()
    )
    ON CONFLICT (hr_provider, hr_employee_id) DO UPDATE SET
      user_id           = EXCLUDED.user_id,
      employment_status = EXCLUDED.employment_status,
      resignation_date  = EXCLUDED.resignation_date,
      last_working_date = EXCLUDED.last_working_date,
      department        = EXCLUDED.department,
      designation       = EXCLUDED.designation,
      manager_name      = EXCLUDED.manager_name,
      manager_email     = EXCLUDED.manager_email,
      location          = EXCLUDED.location,
      phone             = EXCLUDED.phone,
      last_synced_at    = now(),
      raw_hr_data       = EXCLUDED.raw_hr_data,
      updated_at        = now()
    RETURNING id INTO v_profile_id;

    -- 4) Exit handling: deactivate + recover assigned assets.
    IF v_is_exit THEN
      v_deact := v_deact + 1;
      PERFORM public._hr_audit('user.deactivated','profile',v_user_id,
        'User deactivated automatically because exit status was detected from HR portal.',
        jsonb_build_object('employee', v_emp->>'name', 'hr_status', v_status, 'provider', v_src));

      -- Demo only: ensure the exited demo employee has a demo laptop assigned, so the
      -- recovery flow is demonstrable. Real HR data already has real assigned assets.
      v_device := v_emp->>'device';
      IF v_device IS NOT NULL AND (v_emp->>'email') LIKE '%@demo-hr.miles' THEN
        SELECT id INTO v_asset_id FROM public.assets WHERE asset_id = v_device LIMIT 1;
        IF v_asset_id IS NULL THEN
          INSERT INTO public.assets (
            asset_id, asset_type, model, brand, status, ownership,
            assigned_to, assigned_to_name, assigned_email, assigned_at, department, location,
            operating_system, accessories, cpu, invoice, keyboard, monitor_brand, monitor_model,
            monitor_size, mouse, others, phone_number, processor, product_number, ram,
            sim_number, storage, vendor, created_at, updated_at
          ) VALUES (
            v_device, 'Laptop', 'Demo Laptop (HR Sync)', 'Demo', 'Assigned', 'Company',
            v_user_id, v_emp->>'name', v_emp->>'email', now(), v_emp->>'dept', v_emp->>'loc',
            'Windows 11', 'N/A','N/A','N/A','N/A','N/A','N/A',
            'N/A','N/A','N/A','N/A','N/A','N/A','N/A',
            'N/A','N/A','Demo HR Sync', now(), now()
          );
        ELSE
          UPDATE public.assets SET assigned_to=v_user_id, assigned_to_name=v_emp->>'name',
                 assigned_email=v_emp->>'email', status='Assigned', updated_at=now()
           WHERE id=v_asset_id AND status NOT IN ('Recovery Stage','Lost');
        END IF;
      END IF;

      v_recovered := v_recovered + public._recover_user_assets(
        v_user_id, v_profile_id,
        'HR exit ('||v_status||') detected from '||v_src,
        NULLIF(v_emp->>'resignation','')::date, NULLIF(v_emp->>'lwd','')::date);
    END IF;
  END LOOP;

  UPDATE public.hr_sync_logs SET
    sync_status='success', completed_at=now(),
    employees_fetched=v_fetched, users_created=v_created, users_updated=v_updated,
    users_deactivated=v_deact, assets_recovered=v_recovered,
    offboarding_detected=v_deact, errors_count=v_errors,
    raw_summary=jsonb_build_object('fetched',v_fetched,'created',v_created,'updated',v_updated,
      'deactivated',v_deact,'assets_recovered',v_recovered)
  WHERE id = v_log_id;

  UPDATE public.hr_integrations SET last_sync_at=now(), status='connected', last_error=NULL, updated_at=now()
   WHERE id = p_id;

  PERFORM public._hr_audit('integration.sync','hr_integration',p_id,
    'Ran HR sync for '||v_src,
    jsonb_build_object('fetched',v_fetched,'created',v_created,'updated',v_updated,
      'deactivated',v_deact,'assets_recovered',v_recovered));

  RETURN jsonb_build_object(
    'ok', true, 'log_id', v_log_id, 'employees_fetched', v_fetched,
    'users_created', v_created, 'users_updated', v_updated,
    'users_deactivated', v_deact, 'assets_recovered', v_recovered, 'errors', v_errors
  );
END $$;

-- ── Dashboard summary: HR sync + recovery metrics ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_hr_dashboard_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'integrations_connected', (SELECT count(*) FROM public.hr_integrations WHERE status='connected'),
    'active_users',     (SELECT count(*) FROM public.profiles WHERE status='active'),
    'deactivated_users',(SELECT count(*) FROM public.profiles WHERE status='inactive'),
    'hr_synced_users',  (SELECT count(*) FROM public.profiles WHERE hr_source IS NOT NULL),
    'assets_in_recovery', (SELECT count(*) FROM public.asset_recovery
        WHERE recovery_status IN ('recovery_pending','recovery_in_progress','not_reachable','escalated')),
    'last_hr_sync',     (SELECT max(last_sync_at) FROM public.hr_integrations),
    'sync_errors',      (SELECT count(*) FROM public.hr_sync_logs WHERE sync_status='failed'),
    'devices_not_seen_recently', (SELECT count(*) FROM public.asset_recovery
        WHERE recovery_status <> 'recovered'
          AND (last_seen_at IS NULL OR last_seen_at < now() - interval '7 days')),
    'recovery_overdue', (SELECT count(*) FROM public.asset_recovery
        WHERE recovery_status IN ('recovery_pending','recovery_in_progress','not_reachable','escalated')
          AND recovery_started_at < now() - interval '7 days')
  ) INTO v;
  RETURN v;
END $$;

-- ── Remove onboarding/offboarding queue surface ──────────────────────────────
DROP FUNCTION IF EXISTS public.get_onboarding_queue();
DROP FUNCTION IF EXISTS public.get_offboarding_queue();
DROP FUNCTION IF EXISTS public.mark_onboarding_done(uuid);

-- run_hr_sync + get_hr_dashboard_summary already granted to authenticated in base migration.
