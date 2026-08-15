// Exhaustiveness guard: TASK_TYPE_META is a Record<TaskType, ...>, so TS
// already forces it to cover every TASK_TYPES member at compile time — this
// is the runtime mirror, catching the case a future TASK_TYPES addition
// slips in without a matching label/icon (e.g. via an `as any` escape hatch)
// and would otherwise only surface as a blank icon/label in the UI.
import { describe, expect, it } from 'vitest';
import { TASK_TYPES, TASK_TYPE_META } from '../src/lib/taskTypeMeta';

describe('TASK_TYPE_META', () => {
  it('has exactly one entry per TASK_TYPES value, no extras', () => {
    expect(Object.keys(TASK_TYPE_META).sort()).toEqual([...TASK_TYPES].sort());
  });

  it('gives every non-todo type a non-null iconPath, and todo none', () => {
    for (const type of TASK_TYPES) {
      if (type === 'todo') expect(TASK_TYPE_META[type].iconPath).toBeNull();
      else expect(TASK_TYPE_META[type].iconPath).not.toBeNull();
    }
  });
});
