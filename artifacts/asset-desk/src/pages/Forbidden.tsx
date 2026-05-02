import { Link } from "wouter";
import { ShieldOff, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";

export default function Forbidden() {
  const { currentUser } = useAuth();

  const homeHref =
    currentUser?.role === "end_user" ? "/tickets" : "/";

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 mb-5">
        <ShieldOff className="h-8 w-8 text-destructive" />
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">Access Denied</h1>
      <p className="text-muted-foreground text-sm max-w-sm mb-6">
        You do not have permission to access this page. Please contact your IT administrator if you believe this is an error.
      </p>
      <Link href={homeHref}>
        <Button className="gap-2" data-testid="button-go-home">
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Button>
      </Link>
    </div>
  );
}
