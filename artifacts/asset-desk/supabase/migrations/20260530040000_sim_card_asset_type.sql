-- Allow the "Sim Card" asset type.
-- Adding a SIM card failed with
-- 'new row for relation "assets" violates check constraint "assets_asset_type_check"'
-- because the constraint whitelist never included "Sim Card" even though the app's
-- AssetType union does. This re-creates the constraint with the full app type list.

ALTER TABLE public.assets DROP CONSTRAINT IF EXISTS assets_asset_type_check;

ALTER TABLE public.assets
  ADD CONSTRAINT assets_asset_type_check
  CHECK (asset_type = ANY (ARRAY[
    'Laptop'::text, 'Desktop'::text, 'Monitor'::text, 'Mobile'::text, 'Tab'::text,
    'Sim Card'::text, 'Camera'::text, 'CPU'::text, 'Generic Asset'::text,
    'Keyboard'::text, 'Mouse'::text, 'Headset'::text, 'Hard Disk'::text,
    'Speaker'::text, 'Docking Station'::text, 'Printer'::text, 'Router'::text,
    'Server'::text, 'CCTV'::text, 'Smart TV'::text, 'Projector'::text,
    'Network Device'::text, 'Firewall'::text
  ]));
