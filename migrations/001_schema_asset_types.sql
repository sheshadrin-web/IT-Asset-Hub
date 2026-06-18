-- ============================================================
-- Migration 001: Schema & Configuration Admin Panel — Phase 1
-- Asset Types & Fields Configuration
-- Date: 2026-06-18
-- ============================================================
-- SAFE TO RUN MULTIPLE TIMES  (all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- NO existing production data is modified, renamed, or deleted.
-- ============================================================

-- ── 1. Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_asset_types (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,
  group_name  TEXT        NOT NULL
                CHECK (group_name IN ('Main Devices', 'Accessories', 'Fixed Assets')),
  emoji       TEXT        NOT NULL DEFAULT '📦',
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID        REFERENCES profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS schema_asset_fields (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type_id UUID        NOT NULL REFERENCES schema_asset_types(id) ON DELETE CASCADE,
  field_key     TEXT        NOT NULL,
  label         TEXT        NOT NULL,
  field_type    TEXT        NOT NULL DEFAULT 'text'
                CHECK (field_type IN (
                  'text', 'number', 'date', 'dropdown',
                  'multi_select', 'checkbox', 'url', 'file_upload'
                )),
  is_required   BOOLEAN     NOT NULL DEFAULT FALSE,
  is_visible    BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  options       JSONB,
  placeholder   TEXT,
  help_text     TEXT,
  section       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (asset_type_id, field_key)
);

-- ── 2. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_schema_asset_types_active
  ON schema_asset_types (is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_schema_asset_fields_type
  ON schema_asset_fields (asset_type_id, sort_order);

-- ── 3. Auto-updated_at trigger ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_schema_asset_types_updated_at  ON schema_asset_types;
DROP TRIGGER IF EXISTS trg_schema_asset_fields_updated_at ON schema_asset_fields;

CREATE TRIGGER trg_schema_asset_types_updated_at
  BEFORE UPDATE ON schema_asset_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_schema_asset_fields_updated_at
  BEFORE UPDATE ON schema_asset_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 4. PostgreSQL role grants ─────────────────────────────────────────────────
-- Required when tables are created via SQL Editor (not the dashboard UI).
-- Without these, Supabase returns "permission denied" even for authenticated users.

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON schema_asset_types  TO anon, authenticated;
GRANT SELECT ON schema_asset_fields TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON schema_asset_types  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON schema_asset_fields TO authenticated;

-- ── 5. Row-Level Security ────────────────────────────────────────────────────

ALTER TABLE schema_asset_types  ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_asset_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_sat_read"  ON schema_asset_types;
DROP POLICY IF EXISTS "rls_sat_write" ON schema_asset_types;
DROP POLICY IF EXISTS "rls_saf_read"  ON schema_asset_fields;
DROP POLICY IF EXISTS "rls_saf_write" ON schema_asset_fields;

-- All authenticated users can read (form rendering needs this)
CREATE POLICY "rls_sat_read"
  ON schema_asset_types FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "rls_saf_read"
  ON schema_asset_fields FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only super_admin / it_admin can write
CREATE POLICY "rls_sat_write"
  ON schema_asset_types FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin', 'it_admin')
    )
  );

CREATE POLICY "rls_saf_write"
  ON schema_asset_fields FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin', 'it_admin')
    )
  );

-- ── 6. Audit-log write policy (allow authenticated to insert) ────────────────
-- The audit_logs table already exists; we add an insert policy if it's RLS-enabled.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'audit_logs'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY IF NOT EXISTS "rls_audit_logs_insert"
        ON audit_logs FOR INSERT
        TO authenticated
        WITH CHECK (true)
    $pol$;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- policy already exists or table has different RLS setup — safe to skip
END $$;

-- ── 7. Seed: Asset Types ─────────────────────────────────────────────────────
-- Exact values from the live app. ON CONFLICT DO NOTHING = safe to re-run.

INSERT INTO schema_asset_types (name, group_name, emoji, sort_order) VALUES
  ('Laptop',           'Main Devices', '💻', 10),
  ('Desktop',          'Main Devices', '🖥️', 20),
  ('Monitor',          'Main Devices', '🖥',  30),
  ('Mobile',           'Main Devices', '📱', 40),
  ('Tab',              'Main Devices', '📲', 50),
  ('Sim Card',         'Main Devices', '🪪', 60),
  ('Camera',           'Main Devices', '📷', 70),
  ('CPU',              'Main Devices', '🧠', 80),
  ('Generic Asset',    'Main Devices', '📦', 90),
  ('Keyboard',         'Accessories',  '⌨️', 100),
  ('Mouse',            'Accessories',  '🖱️', 110),
  ('Headset',          'Accessories',  '🎧', 120),
  ('Hard Disk',        'Accessories',  '💾', 130),
  ('Speaker',          'Accessories',  '🔊', 140),
  ('Docking Station',  'Accessories',  '🧰', 150),
  ('Printer',          'Fixed Assets', '🖨️', 160),
  ('Router',           'Fixed Assets', '📡', 170),
  ('Server',           'Fixed Assets', '🗄️', 180),
  ('CCTV',             'Fixed Assets', '📹', 190),
  ('Smart TV',         'Fixed Assets', '📺', 200),
  ('Projector',        'Fixed Assets', '🎥', 210),
  ('Network Device',   'Fixed Assets', '📶', 220),
  ('Firewall',         'Fixed Assets', '🔒', 230)
ON CONFLICT (name) DO NOTHING;

-- ── 8. Seed: Fields per asset type ──────────────────────────────────────────

DO $$
DECLARE
  v_laptop_id        UUID;
  v_desktop_id       UUID;
  v_mobile_id        UUID;
  v_tab_id           UUID;
  v_simcard_id       UUID;
  v_cpu_id           UUID;
  v_type_ids         UUID[];
  v_tid              UUID;
  v_ram_opts         JSONB := '["4 GB","8 GB","16 GB","32 GB","64 GB"]';
  v_storage_opts     JSONB := '["128 GB","256 GB","512 GB","1 TB","2 TB"]';
  v_desk_os_opts     JSONB := '["Windows 10","Windows 11","Ubuntu 22.04","Ubuntu 20.04"]';
  v_lap_os_opts      JSONB := '["Windows 10","Windows 11","macOS Sonoma","macOS Ventura","macOS Monterey","Ubuntu 22.04","Ubuntu 20.04","Chrome OS"]';
  v_mob_os_opts      JSONB := '["iOS 17","iOS 16","Android 14","Android 13","Android 12"]';
  v_tab_os_opts      JSONB := '["iPadOS 17","iPadOS 16","Android 14","Android 13","Android 12"]';
  v_mob_storage_opts JSONB := '["64 GB","128 GB","256 GB","512 GB","1 TB"]';
  v_mob_ram_opts     JSONB := '["2 GB","3 GB","4 GB","6 GB","8 GB","12 GB"]';
  v_tab_storage_opts JSONB := '["64 GB","128 GB","256 GB","512 GB"]';
  v_tab_ram_opts     JSONB := '["2 GB","4 GB","6 GB","8 GB","12 GB"]';
  v_sim_prov_opts    JSONB := '["Airtel","Jio","Vodafone"]';
BEGIN
  SELECT id INTO v_laptop_id   FROM schema_asset_types WHERE name = 'Laptop';
  SELECT id INTO v_desktop_id  FROM schema_asset_types WHERE name = 'Desktop';
  SELECT id INTO v_mobile_id   FROM schema_asset_types WHERE name = 'Mobile';
  SELECT id INTO v_tab_id      FROM schema_asset_types WHERE name = 'Tab';
  SELECT id INTO v_simcard_id  FROM schema_asset_types WHERE name = 'Sim Card';
  SELECT id INTO v_cpu_id      FROM schema_asset_types WHERE name = 'CPU';

  -- Common identification + purchase fields for all non-SimCard types
  v_type_ids := ARRAY(
    SELECT id FROM schema_asset_types
    WHERE name NOT IN ('Sim Card')
  );

  FOREACH v_tid IN ARRAY v_type_ids LOOP
    INSERT INTO schema_asset_fields
      (asset_type_id,field_key,label,field_type,is_required,is_visible,sort_order,placeholder,section)
    VALUES
      (v_tid,'brand',          'Brand',           'text',    TRUE, TRUE, 10,'Dell, Apple, HP, Samsung…',       'Device Identification'),
      (v_tid,'model',          'Model',           'text',    TRUE, TRUE, 20,'e.g. Latitude 5540',              'Device Identification'),
      (v_tid,'serialNumber',   'Serial Number',   'text',    TRUE, TRUE, 30,'Unique serial from device label', 'Device Identification'),
      (v_tid,'productNumber',  'Product Number',  'text',    FALSE,TRUE, 40,'Product / Part number',           'Device Identification'),
      (v_tid,'purchaseDate',   'Purchase Date',   'date',    FALSE,TRUE, 50,NULL,                              'Purchase & Warranty'),
      (v_tid,'warrantyEndDate','Warranty End Date','date',   FALSE,TRUE, 60,NULL,                              'Purchase & Warranty'),
      (v_tid,'vendor',         'Vendor',          'text',    FALSE,TRUE, 70,'Supplier / Vendor name',          'Purchase & Warranty'),
      (v_tid,'invoice',        'Invoice Number',  'text',    FALSE,TRUE, 80,'Invoice or PO number',            'Purchase & Warranty'),
      (v_tid,'ownership',      'Ownership',       'dropdown',FALSE,TRUE, 90,NULL,                              'Purchase & Warranty'),
      (v_tid,'location',       'Location',        'text',    TRUE, TRUE,100,NULL,                              'Location & Department'),
      (v_tid,'department',     'Department',      'text',    FALSE,TRUE,110,'e.g. Sales, Finance, Engineering','Location & Department'),
      (v_tid,'accessories',    'Accessories',     'text',    FALSE,TRUE,120,NULL,                              'Accessories & Notes'),
      (v_tid,'remarks',        'Remarks',         'text',    FALSE,TRUE,130,'Device condition, history…',      'Accessories & Notes')
    ON CONFLICT (asset_type_id, field_key) DO NOTHING;
  END LOOP;

  -- Sim Card fields (completely different set)
  INSERT INTO schema_asset_fields
    (asset_type_id,field_key,label,field_type,is_required,is_visible,sort_order,options,placeholder,section)
  VALUES
    (v_simcard_id,'simProvider',  'Provider',              'dropdown',FALSE,TRUE, 10,v_sim_prov_opts,    NULL,                          'Sim Card Details'),
    (v_simcard_id,'phoneNumber',  'Official Mobile Number','text',    FALSE,TRUE, 20,NULL,               'e.g. 9876543210',             'Sim Card Details'),
    (v_simcard_id,'simNumber',    'SIM Number (ICCID)',    'text',    FALSE,TRUE, 30,NULL,               '19-20 digit ICCID number',    'Sim Card Details'),
    (v_simcard_id,'userName',     'User Name',             'text',    FALSE,TRUE, 40,NULL,               'USER NAME from telecom bill', 'Sim Card Details'),
    (v_simcard_id,'billableName', 'Billable Name',         'text',    FALSE,TRUE, 50,NULL,               'BILLABLE NAME',               'Sim Card Details'),
    (v_simcard_id,'useCase',      'Use Case',              'text',    FALSE,TRUE, 60,NULL,               'Use case',                    'Sim Card Details'),
    (v_simcard_id,'planName',     'Plan Name',             'text',    FALSE,TRUE, 70,NULL,               'e.g. 999 Unlimited',          'Sim Card Details'),
    (v_simcard_id,'planAmount',   'Plan Amount',           'text',    FALSE,TRUE, 80,NULL,               'e.g. 999',                    'Sim Card Details'),
    (v_simcard_id,'vendor',       'Vendor',                'text',    FALSE,TRUE, 90,NULL,               'Supplier / Vendor name',      'Purchase & Warranty'),
    (v_simcard_id,'invoice',      'Invoice Number',        'text',    FALSE,TRUE,100,NULL,               'Invoice or PO number',        'Purchase & Warranty'),
    (v_simcard_id,'ownership',    'Ownership',             'dropdown',FALSE,TRUE,110,NULL,               NULL,                          'Purchase & Warranty'),
    (v_simcard_id,'location',     'Location',              'text',    TRUE, TRUE,120,NULL,               NULL,                          'Location & Department'),
    (v_simcard_id,'department',   'Department',            'text',    FALSE,TRUE,130,NULL,               NULL,                          'Location & Department'),
    (v_simcard_id,'remarks',      'Remarks',               'text',    FALSE,TRUE,140,NULL,               NULL,                          'Notes')
  ON CONFLICT (asset_type_id, field_key) DO NOTHING;

  -- Laptop: Hardware Specifications
  INSERT INTO schema_asset_fields
    (asset_type_id,field_key,label,field_type,is_required,is_visible,sort_order,options,placeholder,section)
  VALUES
    (v_laptop_id,'processor',      'Processor',        'text',    FALSE,TRUE,200,NULL,          'e.g. Intel Core i5-1235U','Hardware Specifications'),
    (v_laptop_id,'ram',            'RAM',              'dropdown',FALSE,TRUE,210,v_ram_opts,     NULL,                      'Hardware Specifications'),
    (v_laptop_id,'storage',        'Storage',          'dropdown',FALSE,TRUE,220,v_storage_opts, NULL,                      'Hardware Specifications'),
    (v_laptop_id,'operatingSystem','Operating System', 'dropdown',FALSE,TRUE,230,v_lap_os_opts,  NULL,                      'Hardware Specifications')
  ON CONFLICT (asset_type_id, field_key) DO NOTHING;

  -- Desktop: Hardware Specifications + Peripherals
  INSERT INTO schema_asset_fields
    (asset_type_id,field_key,label,field_type,is_required,is_visible,sort_order,options,placeholder,section)
  VALUES
    (v_desktop_id,'processor',      'Processor',         'text',    FALSE,TRUE,200,NULL,          'e.g. Intel Core i5-1235U', 'Hardware Specifications'),
    (v_desktop_id,'ram',            'RAM',               'dropdown',FALSE,TRUE,210,v_ram_opts,     NULL,                       'Hardware Specifications'),
    (v_desktop_id,'storage',        'Storage',           'dropdown',FALSE,TRUE,220,v_storage_opts, NULL,                       'Hardware Specifications'),
    (v_desktop_id,'operatingSystem','Operating System',  'dropdown',FALSE,TRUE,230,v_desk_os_opts, NULL,                       'Hardware Specifications'),
    (v_desktop_id,'monitorBrand',   'Monitor Brand',     'text',    FALSE,TRUE,240,NULL,          'e.g. Dell, LG, Samsung',   'Peripherals'),
    (v_desktop_id,'monitorModel',   'Monitor Model',     'text',    FALSE,TRUE,250,NULL,          'e.g. U2722D',              'Peripherals'),
    (v_desktop_id,'monitorSize',    'Monitor Size',      'text',    FALSE,TRUE,260,NULL,          'e.g. 24", 27"',            'Peripherals'),
    (v_desktop_id,'keyboard',       'Keyboard',          'text',    FALSE,TRUE,270,NULL,          'e.g. Dell KB216',          'Peripherals'),
    (v_desktop_id,'mouse',          'Mouse',             'text',    FALSE,TRUE,280,NULL,          'e.g. Dell MS116',          'Peripherals'),
    (v_desktop_id,'others',         'Other Peripherals', 'text',    FALSE,TRUE,290,NULL,          'e.g. Webcam, USB Hub',     'Peripherals')
  ON CONFLICT (asset_type_id, field_key) DO NOTHING;

  -- CPU: Hardware Specifications
  INSERT INTO schema_asset_fields
    (asset_type_id,field_key,label,field_type,is_required,is_visible,sort_order,options,placeholder,section)
  VALUES
    (v_cpu_id,'processor',      'Processor',        'text',    FALSE,TRUE,200,NULL,          'e.g. Intel Core i5-1235U','Hardware Specifications'),
    (v_cpu_id,'ram',            'RAM',              'dropdown',FALSE,TRUE,210,v_ram_opts,     NULL,                      'Hardware Specifications'),
    (v_cpu_id,'storage',        'Storage',          'dropdown',FALSE,TRUE,220,v_storage_opts, NULL,                      'Hardware Specifications'),
    (v_cpu_id,'operatingSystem','Operating System', 'dropdown',FALSE,TRUE,230,v_desk_os_opts, NULL,                      'Hardware Specifications')
  ON CONFLICT (asset_type_id, field_key) DO NOTHING;

  -- Mobile: Mobile Details
  INSERT INTO schema_asset_fields
    (asset_type_id,field_key,label,field_type,is_required,is_visible,sort_order,options,placeholder,section)
  VALUES
    (v_mobile_id,'operatingSystem','OS / Version','dropdown',FALSE,TRUE,200,v_mob_os_opts,     NULL,                           'Mobile Details'),
    (v_mobile_id,'ram',            'RAM',         'dropdown',FALSE,TRUE,210,v_mob_ram_opts,    NULL,                           'Mobile Details'),
    (v_mobile_id,'imeiNumber',     'IMEI 1',      'text',    FALSE,TRUE,220,NULL,              '15-digit IMEI (dial *#06#)',    'Mobile Details'),
    (v_mobile_id,'imei2',          'IMEI 2',      'text',    FALSE,TRUE,230,NULL,              'IMEI 2 (dual-SIM devices)',     'Mobile Details'),
    (v_mobile_id,'storage',        'Storage',     'dropdown',FALSE,TRUE,240,v_mob_storage_opts,NULL,                           'Mobile Details')
  ON CONFLICT (asset_type_id, field_key) DO NOTHING;

  -- Tab: Tab Details
  INSERT INTO schema_asset_fields
    (asset_type_id,field_key,label,field_type,is_required,is_visible,sort_order,options,placeholder,section)
  VALUES
    (v_tab_id,'ram',            'RAM',             'dropdown',FALSE,TRUE,200,v_tab_ram_opts,    NULL,'Tab Details'),
    (v_tab_id,'storage',        'Storage',         'dropdown',FALSE,TRUE,210,v_tab_storage_opts,NULL,'Tab Details'),
    (v_tab_id,'operatingSystem','Operating System','dropdown',FALSE,TRUE,220,v_tab_os_opts,     NULL,'Tab Details')
  ON CONFLICT (asset_type_id, field_key) DO NOTHING;

END $$;
