import { Router } from "express";
import nodemailer from "nodemailer";

const router = Router();

// Fixed CC recipients always included on every assignment email
const FIXED_CC = [
  "sheshadri.n@mileseducation.com",
  "bharat.raj@mileseducation.com",
];

function buildAssignEmailHtml(params: {
  userName: string;
  assetId: string;
  assetType: string;
  brand: string;
  model: string;
  serialNumber: string;
  processor?: string;
  ram?: string;
  storage?: string;
  operatingSystem?: string;
  imei1?: string;
  imei2?: string;
  phoneNumber?: string;
  keyboard?: string;
  mouse?: string;
  monitorBrand?: string;
  monitorModel?: string;
  monitorSize?: string;
  accessories?: string;
  senderName: string;
}): string {
  const {
    userName, assetId, assetType, brand, model, serialNumber,
    processor, ram, storage, operatingSystem,
    imei1, imei2, phoneNumber,
    keyboard, mouse, monitorBrand, monitorModel, monitorSize,
    accessories, senderName,
  } = params;

  const firstName = userName.split(" ")[0];

  const row = (label: string, value?: string) =>
    value ? `<li style="margin-bottom:6px"><strong>${label}:</strong> ${value}</li>` : "";

  let assetDetails = "";
  if (assetType === "Laptop") {
    assetDetails = `
      ${row("Serial No", serialNumber)}
      ${row("OS", operatingSystem)}
      ${row("Processor", processor)}
      ${row("RAM", ram)}
      ${row("Storage", storage)}
      ${row("Asset Tag", assetId)}
    `;
  } else if (assetType === "Mobile") {
    assetDetails = `
      ${row("IMEI 1", imei1)}
      ${row("IMEI 2", imei2)}
      ${row("OS", operatingSystem)}
      ${row("RAM", ram)}
      ${row("Storage", storage)}
      ${row("Asset Tag", assetId)}
      ${row("Official Mobile No", phoneNumber)}
    `;
  } else if (assetType === "Desktop") {
    assetDetails = `
      ${row("Serial No", serialNumber)}
      ${row("OS", operatingSystem)}
      ${row("Processor", processor)}
      ${row("RAM", ram)}
      ${row("Storage", storage)}
      ${row("Monitor", monitorBrand && monitorModel ? `${monitorBrand} ${monitorModel}${monitorSize ? ` (${monitorSize})` : ""}` : undefined)}
      ${row("Keyboard", keyboard)}
      ${row("Mouse", mouse)}
      ${row("Asset Tag", assetId)}
    `;
  } else {
    assetDetails = `
      ${row("Serial No", serialNumber)}
      ${row("Asset Tag", assetId)}
    `;
  }

  const accessoriesList = accessories && accessories.trim()
    ? accessories.split(",").map(a => a.trim()).filter(Boolean)
        .map(a => `<li style="margin-bottom:4px">${a}</li>`).join("")
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8" /></head>
<body style="font-family: Arial, sans-serif; font-size: 14px; color: #222; max-width: 680px; margin: 0 auto; padding: 24px;">

  <h2 style="font-size: 18px; margin-bottom: 20px;">Company Asset Details</h2>

  <p>Hi ${firstName},</p>
  <p>As per the information received from HR, the following company assets have been assigned to you. Kindly review the details below:</p>

  <p><strong>Assigned Assets:</strong></p>

  <p><strong>1. ${assetType}: ${brand} ${model}</strong></p>
  <ul style="line-height: 1.7;">${assetDetails}</ul>

  ${accessoriesList ? `<p><strong>Accessories:</strong></p><ul style="line-height:1.7;">${accessoriesList}</ul>` : ""}

  <p>Kindly do the following:</p>
  <ul style="line-height: 1.7;">
    <li>Verify the above asset details</li>
    <li>Attach clear pictures of all assigned assets</li>
    <li>Confirm receipt and acknowledge the same</li>
    <li>Kindly handle these assets with care. As per company policy, any damage beyond normal wear and tear may result in recovery charges</li>
    <li>If you encounter any technical issues, please raise a ticket via the IT Help Desk</li>
  </ul>

  <p>Please ensure this is completed at the earliest.</p>
  <p>If you notice any discrepancies, kindly report them immediately.</p>

  <br/>
  <p style="margin-bottom: 2px;">Best Regards,</p>
  <p style="margin-bottom: 2px; color: #1a56db;"><strong>${senderName}</strong></p>
  <p style="margin-bottom: 2px;"><strong>Associate - Asset Management</strong></p>
  <p style="margin-bottom: 2px;"><strong>Information Technology</strong></p>
  <p style="margin-bottom: 2px;"><strong>Miles Education</strong></p>
  <p style="margin-bottom: 2px;">Bangalore, India</p>

</body>
</html>`;
}

router.post("/email/assign", async (req, res) => {
  const {
    toEmail, toName,
    assetId, assetType, brand, model, serialNumber,
    processor, ram, storage, operatingSystem,
    imei1, imei2, phoneNumber,
    keyboard, mouse, monitorBrand, monitorModel, monitorSize,
    accessories,
    managerEmail,   // optional — resolved from profiles on the frontend
  } = req.body as Record<string, string | undefined>;

  if (!toEmail || !toName || !assetId) {
    res.status(400).json({ error: "toEmail, toName and assetId are required" });
    return;
  }

  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;

  if (!gmailUser || !gmailPass) {
    res.status(500).json({ error: "Gmail credentials not configured" });
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: gmailUser, pass: gmailPass },
  });

  const senderDisplayName = gmailUser.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  const html = buildAssignEmailHtml({
    userName: toName,
    assetId: assetId ?? "",
    assetType: assetType ?? "Asset",
    brand: brand ?? "",
    model: model ?? "",
    serialNumber: serialNumber ?? "",
    processor, ram, storage, operatingSystem,
    imei1, imei2, phoneNumber,
    keyboard, mouse, monitorBrand, monitorModel, monitorSize,
    accessories,
    senderName: senderDisplayName,
  });

  // Build CC list: always include fixed recipients, plus manager if resolved
  const ccList = [...FIXED_CC];
  if (managerEmail && managerEmail.trim() && !ccList.includes(managerEmail.trim())) {
    ccList.push(managerEmail.trim());
  }

  try {
    await transporter.sendMail({
      from: `"Miles Education IT" <${gmailUser}>`,
      to: toEmail,
      cc: ccList.join(", "),
      subject: "Company Asset Details — Miles Education",
      html,
    });
    req.log.info({ toEmail, assetId, cc: ccList }, "Asset assignment email sent");
    res.json({ success: true, cc: ccList });
  } catch (err) {
    req.log.error({ err }, "Failed to send assignment email");
    res.status(500).json({ error: "Failed to send email", detail: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
