/**
 * Shared Kenyan phone-number normalizer.
 *
 * Everything that needs a dialable local number — the Sambaza USSD
 * builder and the manual Paybill "Account Number" SMS parser — goes
 * through this so "0729914983", "729914983", and "254729914983" all
 * collapse to the same local format: 0XXXXXXXXX.
 *
 * Local format (not 254…) is what's actually dialed, since the till
 * SIM is already on the Kenyan network — there's no reason to carry
 * the country code into the USSD string.
 */
export function normalizeToLocal(raw: string): string | null {
  const digits = String(raw).replace(/\D/g, '');

  // 254XXXXXXXXX -> 0XXXXXXXXX
  if (digits.startsWith('254') && digits.length === 12) {
    return '0' + digits.slice(3);
  }

  // Already local: 0XXXXXXXXX
  if (digits.startsWith('0') && digits.length === 10) {
    return digits;
  }

  // 9 digits, no leading 0 or 254 (e.g. a customer typing 729914983
  // or 143255554 into a Paybill Account Number field)
  if (digits.length === 9 && (digits.startsWith('7') || digits.startsWith('1'))) {
    return '0' + digits;
  }

  return null;
}
