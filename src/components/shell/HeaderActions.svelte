<script lang="ts">
  // Header right-cluster island: [Record event] [scratchpad] [todo] [bell] [avatar].
  // Owns the "only one popover open at a time" coordination — each popover
  // component gets `open`/`onToggle`/`onClose` driven from `activePopover`
  // here; escape/outside-click dismissal itself lives in popover.svelte.ts,
  // shared by all four.
  import LogEventModal from '../events/LogEventModal.svelte';
  import ScratchpadPopup from './ScratchpadPopup.svelte';
  import TodoDropdown from './TodoDropdown.svelte';
  import NotificationsBell from './NotificationsBell.svelte';
  import AvatarMenu from './AvatarMenu.svelte';

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

  type PopoverName = 'scratchpad' | 'todo' | 'bell' | 'avatar';
  let activePopover = $state<PopoverName | null>(null);
  let recordEventOpen = $state(false);

  function toggle(name: PopoverName) {
    activePopover = activePopover === name ? null : name;
  }
  function close() {
    activePopover = null;
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

  $effect(() => {
    window.addEventListener('keydown', onKeydown);
    return () => window.removeEventListener('keydown', onKeydown);
  });
</script>

<div class="header-actions">
  <button type="button" class="record-event-pill" onclick={() => { close(); recordEventOpen = true; }}>
    Record event <kbd>e</kbd>
  </button>

  <ScratchpadPopup
    open={activePopover === 'scratchpad'}
    onToggle={() => toggle('scratchpad')}
    onClose={close}
    {courses}
  />

  <TodoDropdown
    open={activePopover === 'todo'}
    onToggle={() => toggle('todo')}
    onClose={close}
    {courses}
  />

  <NotificationsBell
    open={activePopover === 'bell'}
    onToggle={() => toggle('bell')}
    onClose={close}
    {courses}
  />

  <AvatarMenu
    open={activePopover === 'avatar'}
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
    border-radius: 4px;
    background: color-mix(in oklch, var(--accent-contrast) 20%, transparent);
    opacity: 0.85;
  }
</style>
