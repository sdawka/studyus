<script lang="ts">
  import { setAnalyticsOptOut } from '../../lib/analytics/client';
  import { pushToast } from '../../lib/stores/toast';

  let { optedOut }: { optedOut: boolean } = $props();
  let enabled = $state(!optedOut);
  let saving = $state(false);

  async function change(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const nextEnabled = input.checked;
    const previous = enabled;
    enabled = nextEnabled;
    saving = true;
    try {
      const response = await fetch('/api/v1/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { analytics_opt_out: !nextEnabled } }),
      });
      if (!response.ok) throw new Error('settings update failed');
      setAnalyticsOptOut(!nextEnabled);
    } catch {
      enabled = previous;
      pushToast('Could not save analytics privacy setting', 'error');
    } finally {
      saving = false;
    }
  }
</script>

<label class="analytics-setting">
  <span>
    <strong>Share product analytics</strong>
    <small>Share deliberate usage events that help improve Studyus. This never includes session replay, typed text, notes, tutor messages, or quiz answers.</small>
  </span>
  <input type="checkbox" checked={enabled} disabled={saving} onchange={change} />
</label>

<style>
  .analytics-setting { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
  .analytics-setting span { display: grid; gap: 4px; }
  .analytics-setting strong { font-size: 14px; color: var(--text); }
  .analytics-setting small { color: var(--muted); line-height: 1.45; max-width: 440px; }
  .analytics-setting input { margin-top: 3px; accent-color: var(--accent); }
</style>
