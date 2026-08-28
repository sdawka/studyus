<script lang="ts">
  // Orchestrates the 4-stage /learn absorb experience (docs/api.md v1.7):
  // prereq map -> verify (weak prereqs only) -> interest ordering -> absorb
  // chat. Server-rendered initial graph comes in as props; everything after
  // that is client state (apiFetch round-trips for verify/refetch/create).
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';
  import { captureBehavioralEvent } from '../../lib/analytics/client';
  import { createAbsorbAnalytics } from '../../lib/analytics/learning';
  import type { RuntimeConversation, RuntimeConversationSummary } from '../../lib/stores/learnerRuntime';
  import { pushToast } from '../../lib/stores/toast';
  import PrereqGraph from './PrereqGraph.svelte';
  import VerifyQuiz from './VerifyQuiz.svelte';
  import InterestRanker from './InterestRanker.svelte';
  import ScaffoldChat from '../tutor/ScaffoldChat.svelte';
  import type { KcGraph, PrereqNode, TargetKc } from './types';

  interface Props {
    kcId: string;
    initialKc: TargetKc;
    initialPrereqs: PrereqNode[];
    initialWarnings: string[];
    plannedMinutes?: 15 | 25 | 50;
    aiEnabled: boolean;
    aiUnavailableReason: 'disabled' | 'provider_not_configured' | null;
  }
  const { kcId, initialKc, initialPrereqs, initialWarnings, plannedMinutes = 25, aiEnabled, aiUnavailableReason }: Props = $props();

  type Stage = 'map' | 'verify' | 'rank' | 'chat';
  let stage = $state<Stage>('map');

  let kc = $state<TargetKc>(initialKc);
  let prereqs = $state<PrereqNode[]>(initialPrereqs);
  let warnings = $state<string[]>(initialWarnings);
  let verifyIds = $state<string[]>([]);

  let conversation = $state<RuntimeConversation | null>(null);
  let creatingConversation = $state(false);
  const absorbAnalytics = createAbsorbAnalytics(kcId, captureBehavioralEvent);

  onMount(() => absorbAnalytics.reached(1));

  async function refetchGraph() {
    const res = await apiFetch<KcGraph>(`/api/v1/kcs/${kcId}/graph`, {}, "Couldn't refresh prerequisite readiness.");
    if (!res.ok) {
      pushToast(res.error, 'error');
      return;
    }
    kc = res.data.kc;
    prereqs = res.data.prereqs;
    warnings = res.data.warnings;
  }

  function handleVerify(ids: string[]) {
    absorbAnalytics.decided('verify', ids.length);
    verifyIds = ids;
    stage = 'verify';
    absorbAnalytics.reached(2);
  }

  async function handleVerifyDone() {
    await refetchGraph();
    stage = 'map';
  }

  function handleProceed() {
    if (!aiEnabled) {
      pushToast(
        aiUnavailableReason === 'provider_not_configured'
          ? 'AI tutoring is not configured here. Prerequisite maps and seeded verification quizzes still work.'
          : 'AI tutoring is disabled here. Prerequisite maps and seeded verification quizzes still work.',
        'error',
      );
      return;
    }
    const weakCount = prereqs.filter((prereq) => !prereq.ready).length;
    absorbAnalytics.decided('continue_anyway', weakCount);
    stage = 'rank';
    absorbAnalytics.reached(3);
    // No prereqs to rank at all (leaf KC) — the ranking screen would be
    // empty, so skip straight to starting the conversation.
    if (prereqs.length === 0) startAbsorbConversation([kcId]);
  }

  async function startAbsorbConversation(focusOrder: string[]) {
    creatingConversation = true;
    const res = await apiFetch<RuntimeConversationSummary>(
      '/api/v1/tutor/conversations',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kc_id: kcId,
          mode: 'absorb',
          details: { flow: 'absorb', focus_order: focusOrder, planned_minutes: plannedMinutes },
        }),
      },
      "Couldn't start the tutor session right now.",
    );
    creatingConversation = false;
    if (!res.ok) {
      pushToast(res.error, 'error');
      return;
    }
    conversation = { ...res.data, messages: [] };
    stage = 'chat';
    absorbAnalytics.reached(4);
  }
</script>

<div class="absorb-flow">
  <p class="time-budget">Focused session · about {plannedMinutes} minutes</p>
  {#if !aiEnabled}
    <div class="ai-gate" role="status" data-ai-feature="tutor">
      <strong>AI absorb session unavailable</strong>
      <span>You can still inspect prerequisites and run seeded verification quizzes.</span>
    </div>
  {/if}
  {#if stage === 'map'}
    <PrereqGraph {kc} {prereqs} {warnings} onVerify={handleVerify} onProceed={handleProceed} />
  {:else if stage === 'verify'}
    <VerifyQuiz kcIds={verifyIds} onDone={handleVerifyDone} onCancel={() => (stage = 'map')} />
  {:else if stage === 'rank'}
    {#if prereqs.length > 0 && !creatingConversation}
      <InterestRanker {prereqs} targetKcId={kcId} onContinue={startAbsorbConversation} onBack={() => (stage = 'map')} />
    {:else}
      <p class="status">Starting your session…</p>
    {/if}
  {:else if stage === 'chat' && conversation}
    <ScaffoldChat initialConversation={conversation} kcId={kcId} {aiEnabled} {aiUnavailableReason} />
  {/if}
</div>

<style>
  .absorb-flow { display: flex; flex-direction: column; gap: 1.5rem; }
  .status { color: var(--muted); font-size: 0.9rem; }
  .time-budget { margin: 0; color: var(--muted); font-size: 0.82rem; }
  .ai-gate { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.75rem 0.9rem; border: 1px solid var(--warn); border-radius: var(--radius-md); background: var(--warn-soft); color: var(--warn-ink); font-size: 0.85rem; }
</style>
