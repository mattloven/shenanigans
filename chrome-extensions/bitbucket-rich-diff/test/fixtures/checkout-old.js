/**
 * Charges a card.
 * @param {number} amount
 */
export function charge(amount) {
  // Reject empty amounts before calling the gateway.
  if (!amount) return null;
  const pattern = /https?:\/\//; // scheme check, the slashes are not a comment
  return pattern.test(String(amount)) ? null : gateway.capture(amount); // trailing note
}
