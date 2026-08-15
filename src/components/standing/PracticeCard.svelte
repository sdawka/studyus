<script lang="ts">
  import { apiFetch } from '../../lib/apiClient';
  import { formatRelative } from '../../lib/plannerDates';

  interface PracticeSummary {
    practice_events_30d: number;
    distinct_kcs_practiced: number;
    total_kcs: number;
    last_practiced_at: string | null;
    practice_assessments_done: number;
    practice_assessments_total: number;
  }

  interface Props {
    courseId: string;
    courseSlug: string;
    // Bumped by the parent whenever AssessmentsCard adds/marks a practice
    // assessment, so this card's "M of K practice tests done" doesn't go
    // stale within the same visit.
    refreshToken?: number;
  }
  let { courseId, courseSlug, refreshToken = 0 }: Props = $props();

  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let summary = $state<PracticeSummary | null>(null);

  async function load() {
    loading = true;
    loadError = null;
    try {
      const result = await apiFetch<PracticeSummary>(`/api/v1/courses/${courseId}/practice-summary`, {}, 'Could not load practice.', 'Network error.');
      if (!result.ok) {
        // A non-ok response always shows this fixed message (ignoring
        // whatever the server said); only a true network failure shows its
        // own message — matches the pre-apiFetch behavior here.
        loadError = result.reason === 'network' ? result.error : 'Could not load practice.';
        return;
      }
      summary = result.data;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    refreshToken;
    void load();
  });

  const conceptPct = $derived(
    summary && summary.total_kcs > 0 ? Math.round((summary.distinct_kcs_practiced / summary.total_kcs) * 100) : 0,
  );

  function relativeDate(iso: string | null): string {
    if (!iso) return 'never';
    return formatRelative(iso);
  }
</script>

<section class="card practice-card">
  <div class="card-head">
    <h2 class="card-title">Practice</h2>
  </div>

  {#if loading}
    <div class="skeleton">
      <div class="skeleton-row"></div>
      <div class="skeleton-row short"></div>
    </div>
  {:else if loadError}
    <p class="error">{loadError}</p>
  {:else if summary && summary.total_kcs === 0}
    <p class="empty">No concepts to practice yet.</p>
  {:else if summary && summary.practice_events_30d === 0 && summary.distinct_kcs_practiced === 0 && summary.practice_assessments_total === 0}
    <p class="empty">No practice yet — start with a quick quiz.</p>
  {:else if summary}
    <p class="stat-line">
      <span class="num">{summary.distinct_kcs_practiced} of {summary.total_kcs}</span> concepts practiced
    </p>
    <div class="bar"><span style="width: {conceptPct}%"></span></div>

    <p class="sub-line">
      {summary.practice_events_30d} practice {summary.practice_events_30d === 1 ? 'activity' : 'activities'} in the last 30 days
      · last practiced {relativeDate(summary.last_practiced_at)}
    </p>

    {#if summary.practice_assessments_total > 0}
      <p class="sub-line">
        <span class="num">{summary.practice_assessments_done} of {summary.practice_assessments_total}</span> practice tests done
      </p>
    {/if}
  {/if}

  <div class="card-footer">
    <a class="link-btn" href={`/courses/${courseSlug}/practice`}>Go practice →</a>
  </div>
</section>

<style>
  .practice-card { display: flex; flex-direction: column; }
  .error { color: var(--danger); font-size: 13px; }

  .skeleton { display: flex; flex-direction: column; gap: var(--space-2); }
  .skeleton-row { height: 16px; border-radius: var(--radius-sm); background: var(--hairline); opacity: 0.6; }
  .skeleton-row.short { width: 60%; }

  .stat-line { font-size: 13.5px; margin: 0 0 6px; }
  .stat-line .num { font-size: 17px; font-weight: 620; }
  .sub-line { color: var(--muted); font-size: 12.5px; margin: var(--space-2) 0 0; }
  .sub-line .num { font-weight: 600; color: var(--text); }

  .card-footer {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--hairline);
  }
  .link-btn { color: var(--accent); font-size: 12.5px; font-weight: 550; text-decoration: none; }
  .link-btn:hover { text-decoration: underline; }
</style>
