// Normalizes phone numbers to E.164 with Bangladesh as the home country.
// Google Places hands back local formats like "01712-345678" or
// "+880 1712-345678"; Vapi/Twilio and the WhatsApp API both require +8801...
export function toE164(raw, defaultCountry = '880') {
  if (!raw) return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7) return null;

  if (s.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith(defaultCountry) && digits.length >= 12) return `+${digits}`;
  // Local format: 01712345678 (mobile) or 02XXXXXXX (Dhaka landline)
  if (digits.startsWith('0')) return `+${defaultCountry}${digits.slice(1)}`;
  // Bare mobile without the leading zero: 1712345678
  if (digits.startsWith('1') && digits.length === 10) return `+${defaultCountry}${digits}`;
  return `+${digits}`;
}
