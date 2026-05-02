import { useLocation } from "wouter";
import { Monitor, Shield, UserCheck, User, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { UserRole } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const demoAccounts = [
  {
    role: "Super Admin" as UserRole,
    name: "Sarah Mitchell",
    email: "admin@assetdesk.demo",
    icon: Shield,
    color: "text-purple-400",
    bg: "bg-purple-500/10 border-purple-500/30 hover:bg-purple-500/20",
    badgeCls: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    description: "Full access to all modules, users, assets, and reports",
  },
  {
    role: "IT Agent" as UserRole,
    name: "James Thornton",
    email: "agent@assetdesk.demo",
    icon: UserCheck,
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/30 hover:bg-blue-500/20",
    badgeCls: "bg-blue-500/20 text-blue-300 border-blue-500/30",
    description: "Manage assigned tickets, view assets, update statuses",
  },
  {
    role: "End User" as UserRole,
    name: "Emily Clarke",
    email: "user@assetdesk.demo",
    icon: User,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20",
    badgeCls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    description: "Raise and track tickets for asset issues",
  },
];

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();

  const handleLogin = (role: UserRole) => {
    login(role);
    if (role === "End User") {
      setLocation("/tickets");
    } else {
      setLocation("/");
    }
  };

  return (
    <div className="min-h-screen bg-sidebar flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-5/12 flex-col justify-between p-12 bg-gradient-to-br from-sidebar to-slate-900">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Monitor className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-lg font-bold text-white">Asset Desk</div>
            <div className="text-xs text-white/50">IT Asset Management</div>
          </div>
        </div>

        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Manage your IT assets with confidence
          </h1>
          <p className="text-white/60 text-lg leading-relaxed">
            Track laptops, mobiles, and accessories. Handle support tickets. Keep your IT operations running smoothly.
          </p>

          <div className="mt-10 grid grid-cols-2 gap-4">
            {[
              { label: "Assets Tracked", value: "15" },
              { label: "Active Tickets", value: "6" },
              { label: "Users Managed", value: "8" },
              { label: "Resolution Rate", value: "87%" },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl bg-white/5 border border-white/10 p-4">
                <div className="text-2xl font-bold text-white">{stat.value}</div>
                <div className="text-sm text-white/50 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="text-xs text-white/30">
          Demo environment — sample data only
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <Monitor className="h-5 w-5 text-white" />
            </div>
            <div>
              <div className="text-lg font-bold text-white">Asset Desk</div>
              <div className="text-xs text-white/50">IT Asset Management</div>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-white">Welcome back</h2>
            <p className="text-white/50 mt-1 text-sm">
              Select a demo account to explore the platform
            </p>
          </div>

          <div className="space-y-3">
            {demoAccounts.map((account) => {
              const Icon = account.icon;
              return (
                <button
                  key={account.role}
                  onClick={() => handleLogin(account.role)}
                  data-testid={`button-login-${account.role.toLowerCase().replace(" ", "-")}`}
                  className={`w-full rounded-xl border p-4 text-left transition-all duration-200 ${account.bg}`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`mt-0.5 rounded-lg bg-white/10 p-2 ${account.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-white text-sm">{account.name}</span>
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${account.badgeCls}`}>
                          {account.role}
                        </span>
                      </div>
                      <p className="text-xs text-white/50 mb-1">{account.email}</p>
                      <p className="text-xs text-white/40">{account.description}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-white/30 mt-1 flex-shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>

          <p className="mt-6 text-center text-xs text-white/30">
            This is a demo application. All data is simulated.
          </p>
        </div>
      </div>
    </div>
  );
}
