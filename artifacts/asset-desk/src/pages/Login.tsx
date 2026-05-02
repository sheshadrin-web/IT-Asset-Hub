import { useState } from "react";
import { useLocation } from "wouter";
import { Monitor, Shield, UserCheck, User, Eye, EyeOff, ChevronRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { UserRole, ROLE_LABELS } from "@/data/mockData";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface DemoAccount {
  email: string;
  name: string;
  role: UserRole;
  icon: React.ElementType;
  color: string;
  bg: string;
  dot: string;
}

const demoAccounts: DemoAccount[] = [
  {
    email: "admin@demo.com",
    name: "Sarah Mitchell",
    role: "super_admin",
    icon: Shield,
    color: "text-violet-600",
    bg: "bg-violet-50 border-violet-200 hover:bg-violet-100 hover:border-violet-300",
    dot: "bg-violet-500",
  },
  {
    email: "agent1@demo.com",
    name: "James Thornton",
    role: "agent",
    icon: UserCheck,
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200 hover:bg-blue-100 hover:border-blue-300",
    dot: "bg-blue-500",
  },
  {
    email: "agent2@demo.com",
    name: "Raj Patel",
    role: "agent",
    icon: UserCheck,
    color: "text-sky-600",
    bg: "bg-sky-50 border-sky-200 hover:bg-sky-100 hover:border-sky-300",
    dot: "bg-sky-500",
  },
  {
    email: "agent3@demo.com",
    name: "Alex Kim",
    role: "agent",
    icon: UserCheck,
    color: "text-cyan-600",
    bg: "bg-cyan-50 border-cyan-200 hover:bg-cyan-100 hover:border-cyan-300",
    dot: "bg-cyan-500",
  },
  {
    email: "user@demo.com",
    name: "Emily Clarke",
    role: "end_user",
    icon: User,
    color: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300",
    dot: "bg-emerald-500",
  },
];

function getRedirect(role: UserRole): string {
  return role === "end_user" ? "/tickets" : "/";
}

export default function Login() {
  const { loginByEmail } = useAuth();
  const [, setLocation] = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loadingEmail, setLoadingEmail] = useState<string | null>(null);
  const [error, setError] = useState("");

  const doLogin = (emailAddr: string) => {
    setLoadingEmail(emailAddr);
    setError("");
    setTimeout(() => {
      const ok = loginByEmail(emailAddr);
      setLoadingEmail(null);
      if (ok) {
        const account = demoAccounts.find((a) => a.email === emailAddr);
        setLocation(account ? getRedirect(account.role) : "/");
      } else {
        setError("Invalid email address. Try one of the demo accounts below.");
      }
    }, 350);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }
    doLogin(email.trim());
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-blue-200/40 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-indigo-200/40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/80 overflow-hidden">

          {/* Header stripe */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-8 py-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                <Monitor className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white leading-none">Asset Desk Demo</h1>
                <p className="text-blue-100 text-xs mt-0.5">IT Asset &amp; Ticket Management</p>
              </div>
            </div>
          </div>

          {/* Form body */}
          <div className="px-8 py-7">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-slate-800">Welcome back</h2>
              <p className="text-sm text-slate-500 mt-0.5">Sign in to your account to continue</p>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              {/* Email */}
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                  Email address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  placeholder="e.g. admin@demo.com"
                  className="h-10 border-slate-300 bg-slate-50 focus:border-blue-500"
                  data-testid="input-email"
                  autoComplete="email"
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
                    placeholder="Any value (demo mode)"
                    className="h-10 border-slate-300 bg-slate-50 pr-10 focus:border-blue-500"
                    data-testid="input-password"
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
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

              {/* Error */}
              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full h-10 bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm"
                disabled={loadingEmail !== null}
                data-testid="button-login-submit"
              >
                {loadingEmail === email ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Signing in...
                  </span>
                ) : "Sign In"}
              </Button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-5">
              <Separator className="flex-1 bg-slate-200" />
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wide whitespace-nowrap">
                Demo Accounts
              </span>
              <Separator className="flex-1 bg-slate-200" />
            </div>

            {/* Demo login buttons */}
            <div className="space-y-2">
              <p className="text-xs text-slate-500 text-center mb-3">
                Click any account below to sign in instantly
              </p>

              {demoAccounts.map((account) => {
                const Icon = account.icon;
                const isLoading = loadingEmail === account.email;
                return (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => doLogin(account.email)}
                    disabled={loadingEmail !== null}
                    data-testid={`button-demo-${account.email.replace("@", "-at-").replace(".", "-")}`}
                    className={cn(
                      "w-full flex items-center gap-3 rounded-xl border px-4 py-2.5 text-left transition-all duration-150 disabled:opacity-60",
                      account.bg
                    )}
                  >
                    <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg bg-white shadow-sm border flex-shrink-0", account.color)}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-700 truncate">{account.name}</span>
                        <span className="text-xs text-slate-400 font-normal hidden sm:inline">
                          {ROLE_LABELS[account.role]}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={cn("h-1.5 w-1.5 rounded-full flex-shrink-0", account.dot)} />
                        <span className="text-xs text-slate-500 truncate">{account.email}</span>
                      </div>
                    </div>
                    {isLoading ? (
                      <div className="h-4 w-4 rounded-full border-2 border-slate-300 border-t-slate-600 animate-spin flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-slate-50 border-t border-slate-100 px-8 py-3">
            <p className="text-xs text-slate-400 text-center">
              Demo environment — all data is simulated. No real credentials required.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
