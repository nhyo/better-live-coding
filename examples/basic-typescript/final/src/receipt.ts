import { formatPrice } from './format';

export function receiptLine(name: string, cents: number): string {
  return `${name.padEnd(12, '.')} ${formatPrice(cents)}`;
}
