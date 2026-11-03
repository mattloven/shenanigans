/**
 * Charges a card through the gateway.
 * @param {number} amount - minor units
 * @returns {string | null} receipt id
 */
export function charge(amount) {
  // Amounts are in minor units; zero is allowed for account checks.
  if (amount == null) return null;
  const pattern = /https?:\/\//; // scheme check, the slashes are not a comment
  return pattern.test(String(amount)) ? null : gateway.capture(amount);
}
