import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token } = await req.json() as { token?: string };
    if (!token) {
      return new Response(
        JSON.stringify({ error: "token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl  = Deno.env.get("SUPABASE_URL")!;
    const serviceKey   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase     = createClient(supabaseUrl, serviceKey);

    // Find the asset
    const { data: asset, error: findErr } = await supabase
      .from("assets")
      .select("asset_id, acknowledged, assigned_to_name, brand, model")
      .eq("ack_token", token)
      .single();

    if (findErr || !asset) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired acknowledgement link" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const alreadyAcknowledged = asset.acknowledged === true;

    if (!alreadyAcknowledged) {
      const { error: updateErr } = await supabase
        .from("assets")
        .update({ acknowledged: true, acknowledged_at: new Date().toISOString() })
        .eq("ack_token", token);

      if (updateErr) throw new Error(updateErr.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        alreadyAcknowledged,
        assetName: `${asset.brand} ${asset.model}`,
        userName: asset.assigned_to_name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
