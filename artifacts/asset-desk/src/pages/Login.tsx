import { useState } from "react";
import { useLocation } from "wouter";
import { Eye, EyeOff, AlertCircle, CheckCircle2, Mail } from "lucide-react";
import milesLogo from "/miles-logo.png";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { getSiteUrl } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export default function Login() {
  const { signIn, configError } = useAuth();
  const [, setLocation] = useLocation();

  const [email,        setEmail]        = useState("");
  const [password,     setPassword]     = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [forgotOpen,   setForgotOpen]   = useState(false);
  const [forgotEmail,  setForgotEmail]  = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent,   setForgotSent]   = useState(false);
  const [forgotError,  setForgotError]  = useState("");

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

  const openForgotPassword = () => {
    setForgotEmail(email.trim());
    setForgotError("");
    setForgotSent(false);
    setForgotOpen(true);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const requestedEmail = forgotEmail.trim();
    if (!requestedEmail) {
      setForgotError("Please enter your email address.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requestedEmail)) {
      setForgotError("Please enter a valid email address.");
      return;
    }

    setForgotLoading(true);
    setForgotError("");
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(requestedEmail, {
      redirectTo: `${getSiteUrl()}/login`,
    });
    setForgotLoading(false);

    if (resetError) {
      setForgotError("We couldn't send the reset email right now. Please contact your IT Admin.");
      return;
    }

    setForgotSent(true);
  };

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-blue-300/40 blur-3xl" />
        <div className="absolute -bottom-44 -left-40 w-96 h-96 rounded-full bg-indigo-300/40 blur-3xl" />
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[28rem] h-[28rem] rounded-full bg-sky-200/30 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="bg-white/80 backdrop-blur-2xl rounded-3xl shadow-[0_32px_80px_-30px_rgba(30,58,138,0.45)] border border-white/70 ring-1 ring-blue-500/5 overflow-hidden">

          {/* Header stripe */}
          <div className="bg-gradient-to-r from-blue-700 to-indigo-700 px-8 py-7">
            <div className="flex items-center gap-3">
              <div className="h-14 w-14 rounded-xl overflow-hidden flex-shrink-0 shadow-lg bg-white flex items-center justify-center">
                <img src={milesLogo} alt="Miles Education" className="h-full w-full object-contain" />
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
                    onClick={openForgotPassword}
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
                className="w-full h-10 bg-gradient-to-b from-blue-600 to-blue-700 hover:from-blue-600 hover:to-blue-800 text-white font-semibold shadow-[0_8px_20px_-8px_rgba(30,58,138,0.6)]"
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

      <Dialog
        open={forgotOpen}
        onOpenChange={(open) => {
          if (!forgotLoading) {
            setForgotOpen(open);
            if (!open) {
              setForgotError("");
              setForgotSent(false);
            }
          }
        }}
      >
        <DialogContent className="w-[min(92vw,440px)] max-w-[440px]">
          {forgotSent ? (
            <>
              <DialogHeader>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
                <DialogTitle className="text-center">Check your email</DialogTitle>
                <DialogDescription className="text-center">
                  If an account exists for <strong className="break-all text-foreground">{forgotEmail.trim()}</strong>, we sent a password-reset link.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                The link will take you to a secure page where you can create a new password. If you do not receive it, please contact your IT Admin.
              </div>
              <DialogFooter>
                <Button type="button" className="w-full" onClick={() => setForgotOpen(false)}>
                  Return to sign in
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
                  <Mail className="h-6 w-6 text-blue-600" />
                </div>
                <DialogTitle className="text-center">Reset your password</DialogTitle>
                <DialogDescription className="text-center">
                  Enter your account email and we’ll send you a secure password-reset link.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleForgotPassword} className="space-y-4" noValidate>
                <div className="space-y-1.5">
                  <Label htmlFor="forgot-email">Email address</Label>
                  <Input
                    id="forgot-email"
                    type="email"
                    value={forgotEmail}
                    onChange={(e) => { setForgotEmail(e.target.value); setForgotError(""); }}
                    placeholder="you@mileseducation.com"
                    autoComplete="email"
                    autoFocus
                    disabled={forgotLoading}
                    data-testid="input-forgot-email"
                  />
                </div>
                {forgotError && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                    <p className="text-xs leading-relaxed text-red-700">{forgotError}</p>
                  </div>
                )}
                <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
                  <Button type="submit" className="w-full" disabled={forgotLoading}>
                    {forgotLoading ? "Sending reset link…" : "Send reset link"}
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setForgotOpen(false)} disabled={forgotLoading}>
                    Cancel
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
