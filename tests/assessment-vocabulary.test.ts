// The API's assessment vocabulary (src/lib/assessments.ts, the dependency-free
// leaf that src/lib/schemas/assessments.ts builds its zod enums from) and the
// content pipeline's copy (src/lib/content/courseContent.ts) are separate on
// purpose: courses/<slug>/content.json is a versioned file format and must stay
// free to move independently of the API's.
//
// Separate is not the same as unwatched. Byte-identical lists with nothing
// asserting they agree is how drift starts, so this pins that they agree TODAY.
// If you are intentionally splitting them, delete this test and say why in the
// commit — a failure here is a decision to make, not a bug to fix.
import { describe, expect, it } from 'vitest';
import { ASSESSMENT_KINDS, ASSESSMENT_TYPES } from '../src/lib/assessments';
import { CONTENT_ASSESSMENT_KINDS, CONTENT_ASSESSMENT_TYPES } from '../src/lib/content/courseContent';

describe('assessment vocabulary', () => {
  it('content.json assessment types still match the API type list', () => {
    expect([...CONTENT_ASSESSMENT_TYPES]).toEqual([...ASSESSMENT_TYPES]);
  });

  it('content.json assessment kinds still match the API kind list', () => {
    expect([...CONTENT_ASSESSMENT_KINDS]).toEqual([...ASSESSMENT_KINDS]);
  });
});
