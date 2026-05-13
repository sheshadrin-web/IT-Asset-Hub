import { useState } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, AlertCircle } from "lucide-react";
import milesLogo from "/miles-logo.png";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { signIn, configError } = useAuth();
  const [, setLocation] = useLocation();

  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) { setError("Please enter your email address."); return; }
    if (!password)     { setError("Please enter your password.");      return; }

    console.log("[Login] Sign in attempt → email:", email.trim());
    console.log("[Login] Calling signIn...");

    setLoading(true);
    const { error: signInError } = await signIn(email.trim(), password);
    setLoading(false);

    if (signInError) {
      console.error("[Login] signIn returned error:", signInError);
      setError(signInError);
    } else {
      console.log("[Login] signIn success → navigating to /");
      setLocation("/");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-blue-200/40 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-indigo-200/40 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200/80 overflow-hidden">

          {/* Header stripe */}
          <div className="bg-gradient-to-r from-blue-700 to-indigo-700 px-8 py-7">
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-white/30 shadow-lg bg-[#1a1a1a] flex items-center justify-center">
                <img src={milesLogo} alt="Miles Education" className="h-full w-full object-contain p-1" />
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

            {/* Config error banner */}
            {configError && (
              <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-500" />
                <span>
                  <strong>Configuration error:</strong> Supabase URL or anon key is missing.
                  Add <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_URL</code> and{" "}
                  <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> to
                  Replit Secrets, then restart. See <strong>SUPABASE_SETUP.md</strong>.
                </span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
                  disabled={loading || configError}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                    Password
                  </Label>
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium hover:underline"
                    data-testid="link-forgot-password"
                    onClick={() => setError("Please contact your IT Admin to reset your password.")}
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
                    disabled={loading || configError}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    data-testid="button-toggle-password"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Error message */}
              {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                  <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5 text-red-500" />
                  <p className="text-xs text-red-700 leading-relaxed">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                className="w-full h-10 bg-blue-700 hover:bg-blue-800 text-white font-semibold shadow-sm"
                disabled={loading || configError}
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

            <p className="mt-4 text-center text-xs text-slate-400">
              Having trouble signing in? Contact your IT Administrator.
            </p>
          </div>

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
