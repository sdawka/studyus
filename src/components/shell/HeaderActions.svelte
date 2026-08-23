<script lang="ts">
  // Header right-cluster island: [Record event] [scratchpad] [todo] [bell] [avatar].
  // "Only one popover open at a time" is coordinated through the
  // `activePopover` nanostore (src/lib/stores/ui.ts) rather than local
  // state, so any island could in principle drive it — each popover
  // component still just gets `open`/`onToggle`/`onClose` props here.
  // Escape/outside-click dismissal itself lives in popover.svelte.ts,
  // shared by all four.
  import LogEventModal from '../events/LogEventModal.svelte';
  import ScratchpadPopup from './ScratchpadPopup.svelte';
  import TodoDropdown from './TodoDropdown.svelte';
  import NotificationsBell from './NotificationsBell.svelte';
  import AvatarMenu from './AvatarMenu.svelte';
  import { activePopover, togglePopover, closePopover, type PopoverName } from '../../lib/stores/ui';

  interface Course {
    id: string;
    code: string;
    slug: string;
    title: string;
    color?: string | number | null;
  }

  interface Props {
    userName: string;
    userInitials: string;
    courses: Course[];
  }

  let { userName, userInitials, courses }: Props = $props();

  let recordEventOpen = $state(false);

  function toggle(name: PopoverName) {
    togglePopover(name);
  }
  function close() {
    closePopover();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'e') return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
    e.preventDefault();
    close();
    recordEventOpen = true;
  }

  // BottomNav's center FAB (mobile-only) dispatches this into the void —
  // see docs/design/mobile-shell.md. Same open path as the `e` hotkey.
  function onOpenRecordEvent() {
    close();
    recordEventOpen = true;
  }

  $effect(() => {
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('open-record-event', onOpenRecordEvent);
    return () => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('open-record-event', onOpenRecordEvent);
    };
  });
</script>

<div class="header-actions">
  <button type="button" class="record-event-pill" aria-label="Record event" onclick={() => { close(); recordEventOpen = true; }}>
    Record event <kbd>e</kbd>
  </button>

  <!-- Mobile (≤767): the Tasks tab, the FAB, and the avatar sheet cover
       these — hidden here rather than in the popover components
       themselves so ownership stays scoped to this file. -->
  <div class="mobile-hide">
    <ScratchpadPopup
      open={$activePopover === 'scratchpad'}
      onToggle={() => toggle('scratchpad')}
      onClose={close}
      {courses}
    />
  </div>

  <div class="mobile-hide">
    <TodoDropdown
      open={$activePopover === 'todo'}
      onToggle={() => toggle('todo')}
      onClose={close}
      {courses}
    />
  </div>

  <NotificationsBell
    open={$activePopover === 'bell'}
    onToggle={() => toggle('bell')}
    onClose={close}
    {courses}
  />

  <AvatarMenu
    open={$activePopover === 'avatar'}
    onToggle={() => toggle('avatar')}
    onClose={close}
    name={userName}
    initials={userInitials}
  />
</div>

<LogEventModal bind:open={recordEventOpen} />

<style>
  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .record-event-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-contrast);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }
  .record-event-pill:hover { filter: brightness(0.95); }

  .record-event-pill kbd {
    font: 650 10px/1 var(--font-body);
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    background: color-mix(in oklch, var(--accent-contrast) 20%, transparent);
    opacity: 0.85;
  }

  @media (max-width: 767px) {
    .record-event-pill,
    .mobile-hide {
      display: none;
    }
  }
</style>
