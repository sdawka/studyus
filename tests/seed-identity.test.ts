import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEED_USER_EMAIL,
  createSeedIdentity,
  deterministicId,
  seedFixtureId,
} from '../scripts/lib/seed-identity';

describe('seed fixture identity', () => {
  it('keeps the original learner ids stable for reseed compatibility', () => {
    const identity = createSeedIdentity(DEFAULT_SEED_USER_EMAIL);

    expect(seedFixtureId(identity, 'course', 'chee-314-fluid-mechanics')).toBe(
      deterministicId('course', 'chee-314-fluid-mechanics'),
    );
  });

  it('namespaces every direct fixture id by a synthetic learner', () => {
    const first = createSeedIdentity('seed-one@example.test');
    const second = createSeedIdentity('seed-two@example.test');
    const firstCourseId = seedFixtureId(first, 'course', 'shared-course');
    const secondCourseId = seedFixtureId(second, 'course', 'shared-course');

    expect(firstCourseId).toBe(deterministicId('course', `${first.userId}:shared-course`));
    expect(secondCourseId).toBe(deterministicId('course', `${second.userId}:shared-course`));
    expect(firstCourseId).not.toBe(secondCourseId);
  });
});
