import { Profile } from "@/data/mockData";

// Reporting manager is stored on profiles.reporting_manager as a free-text
// field that normally holds the manager's email, but legacy rows may hold a
// display name. These helpers resolve both forms consistently.

/** Returns true if `report` reports to `manager` (matched by email or name). */
export function reportsTo(report: Profile, manager: Profile): boolean {
  const rm = (report.reporting_manager ?? "").trim().toLowerCase();
  if (!rm) return false;
  return rm === manager.email.trim().toLowerCase()
    || rm === manager.full_name.trim().toLowerCase();
}

/** All users who report directly to the given manager. */
export function getDirectReports(manager: Profile, allUsers: Profile[]): Profile[] {
  return allUsers.filter(u => u.id !== manager.id && reportsTo(u, manager));
}

/** Count of direct reports for the given manager. */
export function countDirectReports(manager: Profile, allUsers: Profile[]): number {
  return getDirectReports(manager, allUsers).length;
}

/**
 * Resolve a reporting_manager value (email or name) to the matching profile,
 * if one exists in the user list.
 */
export function resolveManagerProfile(
  reportingManager: string | null | undefined,
  allUsers: Profile[],
): Profile | undefined {
  const rm = (reportingManager ?? "").trim().toLowerCase();
  if (!rm) return undefined;
  return allUsers.find(
    u => u.email.trim().toLowerCase() === rm || u.full_name.trim().toLowerCase() === rm,
  );
}

/** Display label for a reporting_manager value, resolving emails to names. */
export function managerDisplayName(
  reportingManager: string | null | undefined,
  allUsers: Profile[],
): string {
  const rm = (reportingManager ?? "").trim();
  if (!rm) return "Unassigned";
  const mgr = resolveManagerProfile(rm, allUsers);
  return mgr ? mgr.full_name : rm;
}

export interface ManagerGroup {
  manager: Profile;
  reports: Profile[];
}

/**
 * Group every user that has at least one direct report into a manager → reports
 * structure, sorted by manager name. Used by the reporting-structure report.
 */
export function buildReportingStructure(allUsers: Profile[]): ManagerGroup[] {
  return allUsers
    .map(manager => ({ manager, reports: getDirectReports(manager, allUsers) }))
    .filter(g => g.reports.length > 0)
    .sort((a, b) => a.manager.full_name.localeCompare(b.manager.full_name));
}

/**
 * Users whose reporting_manager points at someone who is missing or inactive,
 * plus users with no manager set at all. Surfaced on the dashboard widget.
 */
export function getUsersWithUnassignedManager(allUsers: Profile[]): Profile[] {
  return allUsers.filter(u => {
    const rm = (u.reporting_manager ?? "").trim();
    if (!rm) return true;
    const mgr = resolveManagerProfile(rm, allUsers);
    if (!mgr) return true;
    return mgr.status === "inactive";
  });
}
