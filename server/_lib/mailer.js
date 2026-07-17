import nodemailer from 'nodemailer';

/**
 * SMTP sender (Gmail app password, Outlook, or any SMTP host).
 *
 * Gmail setup: enable 2FA, then create an App Password
 * (myaccount.google.com/apppasswords) and use it as SMTP_PASS — your normal
 * Google password will not work.
 *   SMTP_HOST=smtp.gmail.com  SMTP_PORT=465  SMTP_USER=you@gmail.com
 */
export function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  const missing = Object.entries({ SMTP_HOST, SMTP_USER, SMTP_PASS })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Email is not configured on the server — missing: ${missing.join(', ')}`);

  // An email address in SMTP_HOST surfaces as a cryptic DNS failure
  // ("getaddrinfo EBUSY you@gmail.com") because nodemailer tries to resolve it
  // as a mail server. Say what's actually wrong instead.
  if (SMTP_HOST.includes('@')) {
    throw new Error(
      `SMTP_HOST is set to "${SMTP_HOST}", which is an email address, not a mail server. ` +
      `Use SMTP_HOST=smtp.gmail.com (port 465) and put the address in SMTP_USER instead.`,
    );
  }

  const port = Number(SMTP_PORT) || 465;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

export async function sendMail({ to, subject, html }) {
  const recipient = to || process.env.MANAGER_EMAIL;
  if (!recipient) throw new Error('No recipient — set MANAGER_EMAIL on the server');

  const info = await getTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: recipient,
    subject,
    html,
  });
  return { messageId: info.messageId, accepted: info.accepted, recipient };
}
