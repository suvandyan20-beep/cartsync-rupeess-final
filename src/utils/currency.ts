export const INDIVIDUAL_DELIVERY_FEE_INR = 49;

export function formatINR(amount: number): string {
  const num = Number(amount);
  if (!Number.isFinite(num)) return '₹0';
  const rounded = Math.round(num * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  const absFormatted = Math.abs(isWhole ? Math.round(rounded) : rounded).toLocaleString('en-IN', {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  });
  return rounded < 0 ? `-₹${absFormatted}` : `₹${absFormatted}`;
}
