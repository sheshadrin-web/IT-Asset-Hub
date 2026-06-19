import { CurrentUser, UserRole } from "@/data/mockData";
import { UserLocationAccess } from "@/lib/locationAccess";

// Roles that implicitly see every location (HQ-level visibility).
const ALL_LOCATION_ROLES: UserRole[] = ["super_admin", "it_admin", "it_agent"];

export function canViewAllLocations(user: Pick<CurrentUser, "role"> | null): boolean {
  return !!user && ALL_LOCATION_ROLES.includes(user.role);
}

// Final approval (replacements, shortage fulfilment, advancing returns) is
// limited to Super Admin and Bangalore IT (it_admin = the Bangalore IT team).
export function canApproveRequests(user: Pick<CurrentUser, "role"> | null): boolean {
  return !!user && (user.role === "super_admin" || user.role === "it_admin");
}

// Bangalore IT — the team that owns final approval and the central inventory.
export function isBangaloreIT(user: Pick<CurrentUser, "role"> | null): boolean {
  return canApproveRequests(user);
}

// Roles allowed to open the Location-wise Assets module. Must stay in sync with
// the /locations route guard in App.tsx (HR Admin + End User are excluded).
const MODULE_ROLES: UserRole[] = [...ALL_LOCATION_ROLES, "location_gm"];
export function canAccessLocationModule(user: Pick<CurrentUser, "role"> | null): boolean {
  return !!user && MODULE_ROLES.includes(user.role);
}

// A location_gm may raise requests only where they have can_raise_requests.
// Final-approval roles (Super Admin / Bangalore IT) may always raise. it_agent
// is read-only in this module, so it is intentionally excluded.
export function canRaiseRequestsForLocation(
  user: Pick<CurrentUser, "role"> | null,
  location: string,
  access: UserLocationAccess[],
): boolean {
  if (!user) return false;
  if (canApproveRequests(user)) return true;
  return access.some(a => a.location === location && a.canRaiseRequests);
}

// The set of locations a user may see. HQ roles see all provided locations;
// a location_gm sees only their mapped, view-enabled locations.
export function visibleLocations(
  user: Pick<CurrentUser, "role"> | null,
  allLocations: readonly string[],
  access: UserLocationAccess[],
): string[] {
  if (!user) return [];
  if (canViewAllLocations(user)) return [...allLocations];
  return access.filter(a => a.canViewAssets).map(a => a.location);
}
