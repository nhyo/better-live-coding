import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StepStateMachine } from '../src/engine/stateMachine';
import { EditSuppressor } from '../src/engine/suppressor';

test('beginNext rejects a second Enter while a step runs', () => {
  const machine = new StepStateMachine(3);
  assert.equal(machine.beginNext(), true);
  assert.equal(machine.beginNext(), false);
  assert.equal(machine.completedSteps, 0);
  machine.complete();
  assert.equal(machine.completedSteps, 1);
  assert.equal(machine.running, false);
});

test('no step starts after the last one', () => {
  const machine = new StepStateMachine(1, 1);
  assert.equal(machine.finished, true);
  assert.equal(machine.beginNext(), false);
});

test('pause toggles only while running; skip and abort release a pause', () => {
  const machine = new StepStateMachine(2);
  assert.equal(machine.togglePause(), false);
  machine.beginNext();
  assert.equal(machine.togglePause(), true);
  assert.equal(machine.paused, true);
  assert.equal(machine.togglePause(), false);
  machine.togglePause();
  assert.equal(machine.requestSkip(), true);
  assert.equal(machine.paused, false);
  assert.equal(machine.skipRequested, true);
  machine.cancel();
  assert.equal(machine.skipRequested, false);
  machine.beginNext();
  machine.togglePause();
  machine.requestAbort('exit');
  assert.equal(machine.paused, false);
  assert.equal(machine.abortReason, 'exit');
});

test('restore validates bounds and is refused while running', () => {
  const machine = new StepStateMachine(2);
  assert.throws(() => machine.restore(3), RangeError);
  assert.throws(() => machine.restore(-1), RangeError);
  machine.restore(2);
  assert.equal(machine.finished, true);
  machine.restore(0);
  machine.beginNext();
  assert.throws(() => machine.restore(1), /running/);
});

test('own edits are suppressed, external edits are reported', async () => {
  const suppressor = new EditSuppressor();
  let version = 1;
  const seen: boolean[] = [];
  await suppressor.run(
    'C:\\Work\\A.ts',
    async () => {
      version += 1;
      seen.push(suppressor.isOwnChange('c:/work/a.ts', version));
    },
    () => version
  );
  // A late change event for our own version is still ours.
  assert.equal(suppressor.isOwnChange('C:/Work/A.ts', 2), true);
  // A newer version came from somewhere else.
  assert.equal(suppressor.isOwnChange('C:/Work/A.ts', 3), false);
  assert.deepEqual(seen, [true]);
  assert.equal(suppressor.isOwnChange('other.ts', 1), false);
});
