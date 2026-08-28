import { describe, expect, it } from 'vitest';
import studyFlowSource from '../src/components/study/StudyFlow.svelte?raw';
import quickQuizSource from '../src/components/tutor/QuickQuiz.svelte?raw';
import verifyQuizSource from '../src/components/learn/VerifyQuiz.svelte?raw';
import absorbFlowSource from '../src/components/learn/AbsorbFlow.svelte?raw';
import scaffoldChatSource from '../src/components/tutor/ScaffoldChat.svelte?raw';
import correctionsSource from '../src/components/corrections/CorrectionsLedger.svelte?raw';
import learningSource from '../src/lib/analytics/learning.ts?raw';

describe('learning-surface component wiring', () => {
  it('starts practice only from an existing session and guards completion, discard, and page exit', () => {
    expect(studyFlowSource).toContain('installPageExitAbandonment(practiceAnalytics.abandon)');
    expect(studyFlowSource).toContain("practiceAnalytics.enterStage('reflection')");
    expect(studyFlowSource).toContain('practiceAnalytics.terminal()');
    expect(studyFlowSource.indexOf('practiceAnalytics.start({')).toBeGreaterThan(studyFlowSource.indexOf("step = 'running'"));
    expect(studyFlowSource).toContain("intendedType !== 'quick_quiz'");
  });

  it('starts both quiz surfaces only after generated questions and suppresses exit after grading success', () => {
    for (const source of [quickQuizSource, verifyQuizSource]) {
      expect(source).toContain('quizAnalytics.start(questions.map((question) => question.kc_id), questions.length)');
      expect(source).toContain('installPageExitAbandonment(() => quizAnalytics.abandon(answeredCount()))');
      expect(source).toContain('quizAnalytics.terminal()');
      expect(source.indexOf('quizAnalytics.start(')).toBeGreaterThan(source.indexOf("stage = 'quiz'"));
    }
  });

  it('wires monotonic absorb stages and explicit weak-prerequisite choices', () => {
    expect(absorbFlowSource).toContain('onMount(() => absorbAnalytics.reached(1))');
    expect(absorbFlowSource).toContain("absorbAnalytics.decided('verify', ids.length)");
    expect(absorbFlowSource).toContain("absorbAnalytics.decided('continue_anyway', weakCount)");
    expect(absorbFlowSource).toContain('absorbAnalytics.reached(4)');
  });

  it('orders known-misconception impressions before maintained card actions without tutor lifecycle capture', () => {
    expect(scaffoldChatSource).toContain('misconceptionAnalytics.shown(messageId, misconceptionId)');
    expect(scaffoldChatSource).toContain('misconceptionAnalytics.accepted(messageId, misconceptionId)');
    expect(scaffoldChatSource).toContain('misconceptionAnalytics.dismissed(messageId, misconceptionId)');
    expect(scaffoldChatSource).not.toContain("name: 'tutor_opened'");
    expect(scaffoldChatSource).not.toContain("name: 'tutor_message_sent'");
    expect(scaffoldChatSource).not.toContain("name: 'tutor_abandoned'");
  });

  it('captures correction internalization only in the successful PATCH branch', () => {
    const failureGuard = correctionsSource.indexOf('if (!res.ok)');
    const capture = correctionsSource.indexOf("name: 'correction_internalized'");
    expect(failureGuard).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(failureGuard);
    expect(correctionsSource).toContain('days_since_accepted: wholeDaysSince(res.data.accepted_at)');
  });

  it('keeps learning helpers free of answers, text, notes, and tutor runtime events', () => {
    expect(learningSource).not.toMatch(/prior_belief|correction:|answer:|note:|content:|tutor_opened|tutor_message_sent|tutor_abandoned/);
  });
});
