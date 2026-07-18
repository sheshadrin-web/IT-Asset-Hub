-- ──────────────────────────────────────────────────────────
-- Manager Hierarchy Overview (Dashboard widget data source)
--   Returns four org-chart metrics derived from the
--   profiles.reporting_manager graph. The manager is stored as the
--   manager's email on each employee's profile (see
--   change_reporting_manager RPC).
--
--   Metrics:
--     total_managers              — distinct manager emails referenced by
--                                    active employees (every manager people
--                                    report to).
--     employees_without_manager   — active employees with no reporting manager.
--     managers_with_direct_reports— distinct referenced managers that resolve
--                                    to a real profile (actual users who
--                                    currently have ≥1 direct report).
--     largest_team_size           — most direct reports under any one manager.
--
--   Gated by _hr_can_read() (same privileged role set used across the HR
--   dashboard). Safe to re-run.
-- ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_manager_hierarchy_overview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public._hr_can_read() THEN RAISE EXCEPTION 'forbidden'; END IF;

  WITH emp AS (
    SELECT id, LOWER(TRIM(reporting_manager)) AS mgr
    FROM public.profiles
    WHERE status = 'active'
  ),
  reports AS (
    SELECT mgr, COUNT(*) AS report_count
    FROM emp
    WHERE mgr IS NOT NULL AND mgr <> ''
    GROUP BY mgr
  )
  SELECT jsonb_build_object(
    'total_managers', (SELECT COUNT(*) FROM reports),
    'employees_without_manager', (SELECT COUNT(*) FROM emp WHERE mgr IS NULL OR mgr = ''),
    'managers_with_direct_reports', (
      SELECT COUNT(*) FROM reports r
      WHERE EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE LOWER(TRIM(p.email)) = r.mgr
      )
    ),
    'largest_team_size', COALESCE((SELECT MAX(report_count) FROM reports), 0)
  ) INTO v;

  RETURN v;
END $$;

GRANT EXECUTE ON FUNCTION public.get_manager_hierarchy_overview() TO authenticated;
