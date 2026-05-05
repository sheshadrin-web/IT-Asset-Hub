import { useState } from "react";
import { useLocation } from "wouter";
import { GraduationCap, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

export default function Login() {
  const { loginWithCredentials } = useAuth();
  const [, setLocation] = useLocation();

  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe]   = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) { setError("Please enter your email address."); return; }
    if (!password)     { setError("Please enter your password.");      return; }

    setLoading(true);
    setTimeout(() => {
      const ok = loginWithCredentials(email.trim(), password);
      setLoading(false);
      if (ok) {
        setLocation("/");
      } else {
        setError("Invalid email or password. Please try again.");
      }
    }, 350);
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
          <div className="bg-gradient-to-r from-blue-700 to-indigo-700 px-8 py-7">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm flex-shrink-0">
                <GraduationCap className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-white leading-tight">Miles Education Pvt Ltd</h1>
                <p className="text-blue-200 text-xs mt-0.5">IT Asset &amp; Helpdesk Portal</p>
              </div>
            </div>
          </div>

          {/* Form body */}
          <div className="px-8 py-7">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-slate-800">Welcome back</h2>
              <p className="text-sm text-slate-500 mt-0.5">Sign in with your helpdesk credentials</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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
                  placeholder="you@mileseducation.com"
                  className="h-10 border-slate-300 bg-slate-50 focus:border-blue-500"
                  data-testid="input-email"
                  autoComplete="email"
                  autoFocus
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
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    placeholder="Enter your password"
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
                className="w-full h-10 bg-blue-700 hover:bg-blue-800 text-white font-semibold shadow-sm"
                disabled={loading}
                data-testid="button-login-submit"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Signing in…
                  </span>
                ) : "Sign In"}
              </Button>
            </form>
          </div>

          {/* Footer */}
          <div className="bg-slate-50 border-t border-slate-100 px-8 py-3">
            <p className="text-xs text-slate-400 text-center">
              © {new Date().getFullYear()} Miles Education Pvt Ltd — IT Helpdesk System
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
