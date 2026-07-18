import { useState, useEffect, useMemo } from "react";
import { Users as UsersIcon, Search, Download, RefreshCw, MapPin } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useUsers } from "@/context/UsersContext";
import { ROLE_LABELS } from "@/data/mockData";
import { LOCATION_OPTIONS } from "@/lib/locationOptions";
import { canViewAllLocations, visibleLocations, profileInAnyLocation } from "@/lib/locationPermissions";
import { fetchMyLocationAccess, UserLocationAccess } from "@/lib/locationAccess";
import { exportCsv } from "@/lib/exportCsv";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";

const statusTone: Record<string, string> = {
  active:    "bg-green-100 text-green-700",
  inactive:  "bg-zinc-200 text-zinc-700",
  suspended: "bg-red-100 text-red-700",
};

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export default function LocationUsers() {
  const { currentUser } = useAuth();
  const { users, loading: usersLoading, refresh: refreshUsers } = useUsers();
  const [access, setAccess] = useState<UserLocationAccess[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const acc = currentUser && canViewAllLocations(currentUser) ? [] : await fetchMyLocationAccess();
        if (!cancelled) setAccess(acc);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  const myLocations = useMemo(
    () => visibleLocations(currentUser, LOCATION_OPTIONS, access),
    [currentUser, access],
  );

  const locationUsers = useMemo(
    () => users
      .filter(u => profileInAnyLocation(u.location, myLocations))
      .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")),
    [users, myLocations],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return locationUsers;
    return locationUsers.filter(u =>
      (u.full_name ?? "").toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.department ?? "").toLowerCase().includes(q) ||
      (u.location ?? "").toLowerCase().includes(q));
  }, [locationUsers, search]);

  const handleExport = () => {
    exportCsv(
      `location-users-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Name", "Email", "Role", "Department", "Location", "Status"],
      filtered.map(u => [
        u.full_name ?? "",
        u.email ?? "",
        ROLE_LABELS[u.role] ?? u.role,
        u.department ?? "",
        u.location ?? "",
        cap(u.status ?? ""),
      ]),
    );
  };

  const busy = loading || usersLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UsersIcon className="h-6 w-6 text-primary" /> Users
          </h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            People at your location{myLocations.length === 1 ? "" : "s"}
            {myLocations.length > 0 && <span className="text-foreground font-medium">· {myLocations.join(", ")}</span>}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshUsers} data-testid="button-refresh-location-users">
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, email, department…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-location-users"
          />
        </div>
        <span className="text-xs text-muted-foreground">{filtered.length} user{filtered.length === 1 ? "" : "s"}</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={handleExport}
          disabled={filtered.length === 0}
          data-testid="button-export-location-users"
        >
          <Download className="h-4 w-4 mr-2" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {busy ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin inline mr-2" /> Loading users…
                </TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  No users found for your location{myLocations.length === 1 ? "" : "s"}.
                </TableCell></TableRow>
              ) : filtered.map(u => (
                <TableRow key={u.id} data-testid={`row-location-user-${u.id}`}>
                  <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email || "—"}</TableCell>
                  <TableCell><Badge variant="outline">{ROLE_LABELS[u.role] ?? u.role}</Badge></TableCell>
                  <TableCell>{u.department || "—"}</TableCell>
                  <TableCell>{u.location || "—"}</TableCell>
                  <TableCell>
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${statusTone[u.status] ?? "bg-zinc-100 text-zinc-700"}`}>
                      {cap(u.status ?? "—")}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
