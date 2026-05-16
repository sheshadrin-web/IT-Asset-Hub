import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore — nodemailer works in Deno via npm compat layer
import nodemailer from "npm:nodemailer@6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIXED_CC = ["sheshadri.n@mileseducation.com", "bharat.raj@mileseducation.com"];
const APP_URL  = "https://it-asset-hub-a7rf.onrender.com";

type Reason = "New Joiner" | "Replacement" | "Additional Asset" | "";

interface BulkAsset {
  assetId:         string;
  assetType:       string;
  brand:           string;
  model:           string;
  serialNumber?:   string;
  processor?:      string;
  ram?:            string;
  storage?:        string;
  operatingSystem?:string;
  imei1?:          string;
  imei2?:          string;
  phoneNumber?:    string;
  keyboard?:       string;
  mouse?:          string;
  monitorBrand?:   string;
  monitorModel?:   string;
  monitorSize?:    string;
  accessories?:    string;
  ackToken:        string;
}

function getSubject(reason: Reason, count: number): string {
  if (reason === "New Joiner")       return `Welcome to Miles Education — ${count} IT Asset${count > 1 ? "s" : ""} Assigned`;
  if (reason === "Replacement")      return `IT Asset Replacement — ${count} Asset${count > 1 ? "s" : ""} Assigned`;
  if (reason === "Additional Asset") return `Additional IT Asset${count > 1 ? "s" : ""} Assigned`;
  return `Company Assets Assigned — Miles Education`;
}

function getIntro(firstName: string, reason: Reason, count: number): string {
  const plural = count > 1 ? "assets have" : "asset has";
  if (reason === "New Joiner") {
    return `<p>Hi ${firstName},</p>
<p>Welcome to Miles Education! We're excited to have you on board. As part of your onboarding, the following ${count} IT ${count > 1 ? "assets have" : "asset has"} been assigned to you. Kindly review the details below:</p>`;
  }
  if (reason === "Replacement") {
    return `<p>Hi ${firstName},</p>
<p>As per your replacement request, the following IT ${plural} been issued to you. Kindly review the details below:</p>`;
  }
  if (reason === "Additional Asset") {
    return `<p>Hi ${firstName},</p>
<p>The following additional IT ${plural} been assigned to you. Kindly review the details below:</p>`;
  }
  return `<p>Hi ${firstName},</p>
<p>The following IT ${plural} been assigned to you as per information received from HR. Kindly review the details below:</p>`;
}

function row(label: string, value?: string): string {
  return value ? `<tr><td style="padding:5px 10px 5px 0;color:#555;width:140px;vertical-align:top;"><strong>${label}</strong></td><td style="padding:5px 0;color:#222;">${value}</td></tr>` : "";
}

function buildAssetSection(a: BulkAsset): string {
  const ackUrl = a.ackToken ? `${APP_URL}/ack/${a.ackToken}` : "";

  let details = "";
  if (a.assetType === "Laptop") {
    details = [row("Asset Tag", a.assetId), row("Serial No", a.serialNumber), row("OS", a.operatingSystem), row("Processor", a.processor), row("RAM", a.ram), row("Storage", a.storage)].join("");
  } else if (a.assetType === "Mobile") {
    details = [row("Asset Tag", a.assetId), row("IMEI 1", a.imei1), row("IMEI 2", a.imei2), row("OS", a.operatingSystem), row("RAM", a.ram), row("Storage", a.storage), row("Official Mobile No", a.phoneNumber)].join("");
  } else if (a.assetType === "Desktop") {
    const monitor = a.monitorBrand && a.monitorModel ? `${a.monitorBrand} ${a.monitorModel}${a.monitorSize ? ` (${a.monitorSize})` : ""}` : undefined;
    details = [row("Asset Tag", a.assetId), row("Serial No", a.serialNumber), row("OS", a.operatingSystem), row("Processor", a.processor), row("RAM", a.ram), row("Storage", a.storage), row("Monitor", monitor), row("Keyboard", a.keyboard), row("Mouse", a.mouse)].join("");
  } else {
    details = [row("Asset Tag", a.assetId), row("Serial No", a.serialNumber)].join("");
  }

  const accHtml = (a.accessories ?? "").trim()
    ? `<p style="margin:8px 0 4px;"><strong>Accessories:</strong></p>
<ul style="margin:0;padding-left:20px;color:#444;">
  ${(a.accessories ?? "").split(",").map(x => x.trim()).filter(Boolean).map(x => `<li style="margin-bottom:3px;">${x}</li>`).join("")}
</ul>` : "";

  const ackLink = ackUrl
    ? `<p style="margin:10px 0 0;"><a href="${ackUrl}" style="color:#1a56db;font-size:13px;text-decoration:underline;">Acknowledge receipt of this asset →</a></p>`
    : "";

  return `<div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px 20px;margin-bottom:20px;background:#fafbff;">
  <p style="margin:0 0 10px;font-size:15px;font-weight:bold;color:#1a3a7a;">${a.assetType}: ${a.brand} ${a.model}</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">${details}</table>
  ${accHtml}
  ${ackLink}
</div>`;
}

function buildHtml(body: { toName: string; assets: BulkAsset[]; reason: string; handoverNote?: string }, senderName: string): string {
  const firstName = (body.toName ?? "").split(" ")[0];
  const reason    = (body.reason ?? "") as Reason;
  const count     = body.assets.length;
  const intro     = getIntro(firstName, reason, count);
  const sections  = body.assets.map(buildAssetSection).join("");

  const noteHtml = body.handoverNote
    ? `<p><strong>Handover Notes:</strong> ${body.handoverNote}</p>`
    : "";

  const replacementNote = reason === "Replacement"
    ? `<p><strong>Note:</strong> Kindly ensure your previous device(s) are returned to the IT team at the earliest.</p>`
    : "";

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:700px;margin:0 auto;padding:24px;">
<h2 style="font-size:18px;margin-bottom:20px;">${getSubject(reason, count)}</h2>
${intro}
${noteHtml}
<p style="margin:20px 0 12px;"><strong>Assigned Assets (${count}):</strong></p>
${sections}
${replacementNote}
<p>Kindly do the following for each asset:</p>
<ul style="line-height:1.8;">
  <li>Verify the asset details listed above</li>
  <li>Attach clear pictures of all assigned assets</li>
  <li>Click the individual acknowledge links above for each asset</li>
  <li>Handle these assets with care. As per company policy, any damage beyond normal wear and tear may result in recovery charges</li>
  <li>For any technical issues, please raise a ticket via the IT Help Desk</li>
</ul>
<p>If you notice any discrepancies, kindly report them immediately.</p>
<br/>
<p style="margin-bottom:2px;">Regards,</p>
<p style="margin-bottom:8px;color:#1a3a7a;"><strong>IT Help Desk</strong></p>
<p style="margin-bottom:2px;">Miles Education | Bangalore</p>
<p style="margin-bottom:2px;">E: <a href="mailto:help.desk@mileseducation.com" style="color:#1a56db;text-decoration:none;">help.desk@mileseducation.com</a></p>
<p style="margin-bottom:2px;"><a href="https://www.mileseducation.com" style="color:#1a56db;text-decoration:none;">www.mileseducation.com</a></p>
</body></html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json() as { toEmail: string; toName: string; assets: BulkAsset[]; managerEmail?: string; reason?: string; handoverNote?: string };
    const { toEmail, toName, assets, managerEmail } = body;

    if (!toEmail || !toName || !Array.isArray(assets) || assets.length === 0) {
      return new Response(
        JSON.stringify({ error: "toEmail, toName and assets[] are required" }),
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

    const html     = buildHtml(body, senderName);
    const subject  = getSubject((body.reason ?? "") as Reason, assets.length);
    const ccList   = [...FIXED_CC];
    if (managerEmail && !ccList.includes(managerEmail)) ccList.push(managerEmail);

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });

    await transporter.sendMail({
      from: `"Miles Education IT" <${gmailUser}>`,
      to:   toEmail,
      cc:   ccList.join(", "),
      subject,
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
