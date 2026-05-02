import { useState } from "react";
import { useLocation } from "wouter";
import { Monitor, Shield, UserCheck, User, Eye, EyeOff, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { UserRole } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const demoAccounts = [
  {
    role: "Super Admin" as UserRole,
    name: "Super Admin",
    icon: Shield,
    color: "text-violet-600",
    bg: "bg-violet-50 border-violet-200 hover:bg-violet-100 hover:border-violet-300",
    dot: "bg-violet-500",
  },
  {
    role: "IT Agent" as UserRole,
    name: "IT Agent",
    icon: UserCheck,
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300",
    dot: "bg-blue-500",
  },
  {
    role: "End User" as UserRole,
    name: "End User",
    icon: User,
    color: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300",
    dot: "bg-emerald-500",
  },
];

export default function Login() {
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("admin@assetdesk.demo");
  const [password, setPassword] = useState("••••••••");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loadingRole, setLoadingRole] = useState<UserRole | null>(null);

  const handleDemoLogin = (role: UserRole) => {
    setLoadingRole(role);
    setTimeout(() => {
      login(role);
      setLoadingRole(null);
      setLocation(role === "End User" ? "/tickets" : "/");
    }, 400);
  };

  const handleFormLogin = (e: React.FormEvent) => {
    e.preventDefault();
    handleDemoLogin("Super Admin");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-blue-200/40 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-indigo-200/40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/80 overflow-hidden">
          {/* Header stripe */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                <Monitor className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white leading-none">Asset Desk Demo</h1>
                <p className="text-blue-100 text-xs mt-0.5">IT Asset & Ticket Management</p>
              </div>
            </div>
          </div>

          {/* Form body */}
          <div className="px-8 py-7">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-slate-800">Welcome back</h2>
              <p className="text-sm text-slate-500 mt-0.5">Sign in to your account to continue</p>
            </div>

            <form onSubmit={handleFormLogin} className="space-y-4">
              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="h-10 border-slate-300 focus:border-blue-500 focus:ring-blue-500 bg-slate-50"
                  data-testid="input-email"
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                    Password
                  </Label>
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline"
                    onClick={() => {}}
                    data-testid="link-forgot-password"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="h-10 border-slate-300 focus:border-blue-500 focus:ring-blue-500 bg-slate-50 pr-10"
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((p) => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    data-testid="button-toggle-password"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Remember me */}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(v) => setRememberMe(!!v)}
                  data-testid="checkbox-remember"
                  className="border-slate-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                />
                <Label htmlFor="remember" className="text-sm text-slate-600 cursor-pointer font-normal">
                  Remember me for 30 days
                </Label>
              </div>

              {/* Login button */}
              <Button
                type="submit"
                className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm"
                data-testid="button-login-submit"
              >
                Sign In
              </Button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-6">
              <Separator className="flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">Demo Access</span>
              <Separator className="flex-1 bg-slate-200" />
            </div>

            {/* Demo login buttons */}
            <div className="space-y-2.5">
              <p className="text-xs text-slate-500 text-center mb-3">
                Click any role below to explore the platform instantly
              </p>
              {demoAccounts.map((account) => {
                const Icon = account.icon;
                const isLoading = loadingRole === account.role;
                return (
                  <button
                    key={account.role}
                    type="button"
                    onClick={() => handleDemoLogin(account.role)}
                    disabled={loadingRole !== null}
                    data-testid={`button-demo-${account.role.toLowerCase().replace(/\s+/g, "-")}`}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-150 disabled:opacity-60",
                      account.bg
                    )}
                  >
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm border", account.color)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-slate-700">
                        Login as {account.name}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full", account.dot)} />
                        <span className="text-xs text-slate-500">Demo account</span>
                      </div>
                    </div>
                    {isLoading ? (
                      <div className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-slate-50 border-t border-slate-100 px-8 py-4">
            <p className="text-xs text-slate-400 text-center">
              Demo environment — all data is simulated. No real credentials required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
