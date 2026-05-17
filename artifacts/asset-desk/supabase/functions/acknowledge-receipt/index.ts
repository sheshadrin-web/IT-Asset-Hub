import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore
import nodemailer from "npm:nodemailer@6";
// @ts-ignore — explicit import required in Deno for Node.js Buffer compatibility
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IT_TEAM = ["sheshadri.n@mileseducation.com", "bharat.raj@mileseducation.com"];

// ── action: "info" — validate token & return asset details without marking ack ──
async function handleInfo(token: string, sb: ReturnType<typeof createClient>) {
  const { data: asset, error } = await sb
    .from("assets")
    .select("asset_id, brand, model, asset_type, acknowledged, assigned_to_name, assigned_email")
    .eq("ack_token", token)
    .single();

  if (error || !asset) {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid or expired acknowledgement link" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      success:             true,
      alreadyAcknowledged: asset.acknowledged === true,
      assetName:           `${asset.brand} ${asset.model}`,
      assetType:           asset.asset_type,
      userName:            asset.assigned_to_name,
      userEmail:           asset.assigned_email,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ── action: "submit" — mark ack, store photos, send email to IT team ──
async function handleSubmit(
  token: string,
  photoUrls: string[],
  sb: ReturnType<typeof createClient>,
) {
  const { data: asset, error: findErr } = await sb
    .from("assets")
    .select("asset_id, brand, model, asset_type, acknowledged, assigned_to_name, assigned_email")
    .eq("ack_token", token)
    .single();

  if (findErr || !asset) {
    return new Response(
      JSON.stringify({ success: false, error: "Invalid or expired acknowledgement link" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (asset.acknowledged) {
    return new Response(
      JSON.stringify({ success: true, alreadyAcknowledged: true, assetName: `${asset.brand} ${asset.model}`, userName: asset.assigned_to_name }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Mark acknowledged + save photo URLs
  const { error: updateErr } = await sb
    .from("assets")
    .update({
      acknowledged:    true,
      acknowledged_at: new Date().toISOString(),
      asset_photos:    photoUrls.length > 0 ? photoUrls : null,
    })
    .eq("ack_token", token);

  if (updateErr) throw new Error(updateErr.message);

  // Send email to IT team with photo attachments
  const gmailUser = Deno.env.get("GMAIL_USER") ?? "";
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";

  if (gmailUser && gmailPass && photoUrls.length > 0) {
    try {
      // Download photos and attach to email
      const attachments: Array<{ filename: string; content: Uint8Array; contentType: string }> = [];
      for (let i = 0; i < photoUrls.length; i++) {
        try {
          const res = await fetch(photoUrls[i]);
          if (res.ok) {
            const buf  = await res.arrayBuffer();
            const ext  = photoUrls[i].split("?")[0].split(".").pop() ?? "jpg";
            attachments.push({
              filename:    `asset-photo-${i + 1}.${ext}`,
              content:     new Uint8Array(buf),
              contentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
            });
          }
        } catch { /* skip failed downloads */ }
      }

      const photoLinks = photoUrls
        .map((url, i) => `<li><a href="${url}" style="color:#1a56db;">Photo ${i + 1}</a></li>`)
        .join("");

      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:600px;margin:0 auto;padding:24px;">
<h2 style="color:#1a3a7a;">Asset Receipt Acknowledged — ${asset.brand} ${asset.model}</h2>
<p><strong>${asset.assigned_to_name ?? "The user"}</strong> (${asset.assigned_email ?? ""}) has acknowledged receipt of the following asset and uploaded ${photoUrls.length} photo(s) as proof:</p>
<ul>
  <li><strong>Asset:</strong> ${asset.brand} ${asset.model}</li>
  <li><strong>Type:</strong> ${asset.asset_type}</li>
  <li><strong>Asset ID:</strong> ${asset.asset_id}</li>
  <li><strong>Acknowledged at:</strong> ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</li>
</ul>
<p><strong>Uploaded Photos:</strong></p>
<ul>${photoLinks}</ul>
<p style="color:#555;font-size:12px;">The photos are also attached to this email.</p>
<br/>
<p style="margin-bottom:2px;">IT Asset Management System</p>
<p style="color:#1a3a7a;"><strong>Miles Education Pvt Ltd</strong></p>
</body></html>`;

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: gmailUser, pass: gmailPass },
      });

      await transporter.sendMail({
        from:        `"Miles Education IT" <${gmailUser}>`,
        to:          IT_TEAM.join(", "),
        subject:     `✓ Asset Acknowledged — ${asset.brand} ${asset.model} by ${asset.assigned_to_name ?? "User"}`,
        html,
        attachments: attachments.map(a => ({
          filename:    a.filename,
          content:     Buffer.from(a.content),
          contentType: a.contentType,
        })),
      });
    } catch { /* email is non-fatal */ }
  }

  return new Response(
    JSON.stringify({
      success:            true,
      alreadyAcknowledged: false,
      assetName:          `${asset.brand} ${asset.model}`,
      userName:           asset.assigned_to_name,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as { token?: string; action?: string; photoUrls?: string[] };
    const { token, action = "submit", photoUrls = [] } = body;

    if (!token) {
      return new Response(
        JSON.stringify({ error: "token is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "info") return await handleInfo(token, sb);
    return await handleSubmit(token, photoUrls, sb);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
