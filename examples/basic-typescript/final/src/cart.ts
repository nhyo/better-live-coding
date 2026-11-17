// Shopping cart for the Better Live Coding basic example.
import { LEGACY_DISCOUNT_PERCENT } from './crlf/legacy';

export interface CartItem {
  name: string;
  priceCents: number;
  quantity: number;
}

const items: CartItem[] = [];
let lastError = '';

export function addItem(name: string, priceCents: number, quantity = 1): void {
  if (quantity <= 0 || !Number.isInteger(quantity)) {
    lastError = `Invalid quantity for ${name}`;
    throw new Error(lastError);
  }
  items.push({ name, priceCents, quantity });
}

export function totalCents(): number {
  const subtotal = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  return Math.round(subtotal * (1 - LEGACY_DISCOUNT_PERCENT / 100));
}

export function getLastError(): string {
  return lastError;
}
