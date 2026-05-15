import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — nodemailer works in Deno via npm compat layer
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIXED_CC = ["sheshadri.n@mileseducation.com", "bharat.raj@mileseducation.com"];

function buildHtml(p: Record<string, string | undefined>, senderName: string): string {
  const firstName = (p.toName ?? "").split(" ")[0];
  const row = (label: string, value?: string) =>
    value ? `<li style="margin-bottom:6px"><strong>${label}:</strong> ${value}</li>` : "";

  let details = "";
  if (p.assetType === "Laptop") {
    details = [
      row("Serial No", p.serialNumber), row("OS", p.operatingSystem),
      row("Processor", p.processor), row("RAM", p.ram),
      row("Storage", p.storage), row("Asset Tag", p.assetId),
    ].join("");
  } else if (p.assetType === "Mobile") {
    details = [
      row("IMEI 1", p.imei1), row("IMEI 2", p.imei2),
      row("OS", p.operatingSystem), row("RAM", p.ram),
      row("Storage", p.storage), row("Asset Tag", p.assetId),
      row("Official Mobile No", p.phoneNumber),
    ].join("");
  } else if (p.assetType === "Desktop") {
    const monitor = p.monitorBrand && p.monitorModel
      ? `${p.monitorBrand} ${p.monitorModel}${p.monitorSize ? ` (${p.monitorSize})` : ""}`
      : undefined;
    details = [
      row("Serial No", p.serialNumber), row("OS", p.operatingSystem),
      row("Processor", p.processor), row("RAM", p.ram),
      row("Storage", p.storage), row("Monitor", monitor),
      row("Keyboard", p.keyboard), row("Mouse", p.mouse),
      row("Asset Tag", p.assetId),
    ].join("");
  } else {
    details = [row("Serial No", p.serialNumber), row("Asset Tag", p.assetId)].join("");
  }

  const accList = (p.accessories ?? "").trim()
    ? (p.accessories ?? "").split(",").map((a: string) => a.trim()).filter(Boolean)
        .map((a: string) => `<li style="margin-bottom:4px">${a}</li>`).join("")
    : "";

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:680px;margin:0 auto;padding:24px;">
<h2 style="font-size:18px;margin-bottom:20px;">Company Asset Details</h2>
<p>Hi ${firstName},</p>
<p>As per the information received from HR, the following company assets have been assigned to you. Kindly review the details below:</p>
<p><strong>Assigned Assets:</strong></p>
<p><strong>1. ${p.assetType}: ${p.brand} ${p.model}</strong></p>
<ul style="line-height:1.7;">${details}</ul>
${accList ? `<p><strong>Accessories:</strong></p><ul style="line-height:1.7;">${accList}</ul>` : ""}
<p>Kindly do the following:</p>
<ul style="line-height:1.7;">
  <li>Verify the above asset details</li>
  <li>Attach clear pictures of all assigned assets</li>
  <li>Confirm receipt and acknowledge the same</li>
  <li>Kindly handle these assets with care. As per company policy, any damage beyond normal wear and tear may result in recovery charges</li>
  <li>If you encounter any technical issues, please raise a ticket via the IT Help Desk</li>
</ul>
<p>Please ensure this is completed at the earliest.</p>
<p>If you notice any discrepancies, kindly report them immediately.</p>
<br/>
<p style="margin-bottom:2px;">Best Regards,</p>
<p style="margin-bottom:2px;color:#1a56db;"><strong>${senderName}</strong></p>
<p style="margin-bottom:2px;"><strong>Associate - Asset Management</strong></p>
<p style="margin-bottom:2px;"><strong>Information Technology</strong></p>
<p style="margin-bottom:2px;"><strong>Miles Education</strong></p>
<p style="margin-bottom:2px;">Bangalore, India</p>
</body></html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as Record<string, string | undefined>;
    const { toEmail, toName, managerEmail } = body;

    if (!toEmail || !toName) {
      return new Response(
        JSON.stringify({ error: "toEmail and toName are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const gmailUser = Deno.env.get("GMAIL_USER") ?? "";
    const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD") ?? "";

    if (!gmailUser || !gmailPass) {
      return new Response(
        JSON.stringify({ error: "Gmail credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const senderName = gmailUser.split("@")[0]
      .replace(/[._]/g, " ")
      .replace(/\b\w/g, (c: string) => c.toUpperCase());

    const html = buildHtml(body, senderName);

    const ccList = [...FIXED_CC];
    if (managerEmail && !ccList.includes(managerEmail)) ccList.push(managerEmail);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
      from: `"Miles Education IT" <${gmailUser}>`,
      to: toEmail,
      cc: ccList.join(", "),
      subject: "Company Asset Details — Miles Education",
      html,
    });

    return new Response(
      JSON.stringify({ success: true, cc: ccList }),
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
