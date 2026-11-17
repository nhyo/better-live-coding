import { addItem, totalCents } from './cart';
import { receiptLine } from './receipt';

addItem('Notebook', 450, 2);
addItem('Pen', 120);

try {
  addItem('Broken', 100, 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
}

console.log(receiptLine('Total', totalCents()));
