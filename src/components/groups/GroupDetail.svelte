<script lang="ts">
  import { onMount } from 'svelte';
  import { apiFetch } from '../../lib/apiClient';
  import { safeWebUrl } from '../../lib/webUrl';
  import type { GroupDetailData, GroupEvent, GroupFile, GroupMember, GroupResource } from './types';

  interface CourseOption {
    id: string;
    code: string;
    title: string;
  }

  interface PrivateAttachmentOption {
    attachment_id: string;
    filename: string;
    size_bytes?: number | null;
    mime_type?: string | null;
  }

  interface Props {
    groupId: string;
    initialData?: GroupDetailData | null;
    viewerUserId?: string;
  }

  let { groupId, initialData = null, viewerUserId }: Props = $props();
  let data = $state<GroupDetailData | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mutationError = $state<string | null>(null);
  // Owner identity is intentionally omitted from public group DTOs. The
  // lifecycle state is the source of truth for whether this group accepts
  // writes; role and membership are used only for moderation controls.
  let readOnly = $derived(data?.group.state === 'read_only');
  let viewerMember = $derived(data?.members?.find((member) => member.member_id === viewerUserId));
  let isOwner = $derived(data?.group.role === 'owner' || viewerMember?.role === 'owner');

  let inviteEmail = $state('');
  let inviting = $state(false);
  let inviteError = $state<string | null>(null);
  let invitePath = $state<string | null>(null);
  let copied = $state(false);

  let resourceLabel = $state('');
  let resourceUrl = $state('');
  let resourceEditing = $state<string | null>(null);
  let resourceSaving = $state(false);
  let resourceError = $state<string | null>(null);

  let fileInputEl = $state<HTMLInputElement | null>(null);
  let uploading = $state(false);
  let fileError = $state<string | null>(null);
  let courses = $state<CourseOption[]>([]);
  let coursesLoading = $state(false);
  let coursesError = $state<string | null>(null);
  let selectedCourseId = $state('');
  let privateAttachments = $state<PrivateAttachmentOption[]>([]);
  let attachmentsLoading = $state(false);
  let attachmentsError = $state<string | null>(null);
  let attachmentId = $state('');
  let attachmentRequestId = 0;
  let copyingAttachment = $state(false);
  let copyError = $state<string | null>(null);

  let eventTitle = $state('');
  let eventStarts = $state('');
  let eventEnds = $state('');
  let eventTimezone = $state('UTC');
  let eventEditing = $state<string | null>(null);
  let eventSaving = $state(false);
  let eventError = $state<string | null>(null);

  function currentTimezone(): string {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
  }

  function normalizeData(value: GroupDetailData): GroupDetailData {
    const groupWithMembers = value.group as GroupDetailData['group'] & { members?: GroupMember[] };
    return {
      ...value,
      members: value.members ?? groupWithMembers.members ?? [],
      resources: value.resources ?? [],
      files: value.files ?? [],
      events: value.events ?? [],
    };
  }

  async function loadGroup() {
    loading = true;
    error = null;
    const result = await apiFetch<GroupDetailData | GroupDetailData['group']>(`/api/v1/groups/${encodeURIComponent(groupId)}`, {}, 'Could not load group');
    if (result.ok) {
      if ('group' in result.data) {
        const members = result.data.members
          ? null
          : await apiFetch<{ members: GroupMember[] }>(`/api/v1/groups/${groupId}/members`, {}, 'Could not load members');
        data = normalizeData({
          ...result.data,
          members: result.data.members ?? (members?.ok ? members.data.members : []),
        });
      } else {
        // The group detail route can return the group row while the three
        // collection routes are independently deployable. Keep the page
        // useful during that rolling boundary and hydrate each collection.
        const members = await apiFetch<{ members: GroupMember[] }>(`/api/v1/groups/${groupId}/members`, {}, 'Could not load members');
        const [resources, files, events] = await Promise.all([
          apiFetch<{ resources: GroupResource[] }>(`/api/v1/groups/${groupId}/resources`, {}, 'Could not load resources'),
          apiFetch<{ files: GroupFile[] }>(`/api/v1/groups/${groupId}/files`, {}, 'Could not load files'),
          apiFetch<{ events: GroupEvent[] }>(`/api/v1/groups/${groupId}/events`, {}, 'Could not load sessions'),
        ]);
        data = normalizeData({
          group: result.data,
          members: members.ok ? members.data.members : [],
          resources: resources.ok ? resources.data.resources : [],
          files: files.ok ? files.data.files : [],
          events: events.ok ? events.data.events : [],
        });
      }
    } else error = result.error;
    loading = false;
    if (data && data.group.state !== 'read_only') void loadPrivateCourses();
  }

  async function loadPrivateCourses() {
    if (data?.group.state === 'read_only') return;
    coursesLoading = true;
    coursesError = null;
    const result = await apiFetch<CourseOption[]>('/api/v1/courses', {}, 'Could not load courses');
    if (result.ok) {
      courses = result.data ?? [];
      if (!courses.some((course) => course.id === selectedCourseId)) {
        selectedCourseId = '';
        privateAttachments = [];
        attachmentId = '';
      }
    } else {
      courses = [];
      selectedCourseId = '';
      privateAttachments = [];
      attachmentId = '';
      coursesError = result.error;
    }
    coursesLoading = false;
  }

  async function loadPrivateAttachments(courseId: string) {
    const requestId = ++attachmentRequestId;
    selectedCourseId = courseId;
    attachmentId = '';
    privateAttachments = [];
    attachmentsError = null;
    if (!courseId) return;

    attachmentsLoading = true;
    const result = await apiFetch<{ attachments: PrivateAttachmentOption[] }>(
      `/api/v1/courses/${encodeURIComponent(courseId)}/attachments`,
      {},
      'Could not load private files',
    );
    if (requestId !== attachmentRequestId) return;
    if (result.ok) privateAttachments = result.data.attachments ?? [];
    else attachmentsError = result.error;
    attachmentsLoading = false;
  }

  function handleCourseChange(event: Event) {
    const courseId = (event.currentTarget as HTMLSelectElement).value;
    void loadPrivateAttachments(courseId);
  }

  function handleAttachmentChange(event: Event) {
    attachmentId = (event.currentTarget as HTMLSelectElement).value;
  }

  onMount(() => {
    eventTimezone = currentTimezone();
    if (initialData !== null) {
      data = normalizeData(initialData);
      loading = false;
      void loadPrivateCourses();
    } else {
      void loadGroup();
    }
  });

  function setMutationError(message: string | null) {
    mutationError = message;
    if (message) window.setTimeout(() => { if (mutationError === message) mutationError = null; }, 5000);
  }

  async function inviteMember(event: SubmitEvent) {
    event.preventDefault();
    inviteError = null;
    invitePath = null;
    if (!inviteEmail.trim()) { inviteError = 'Enter the owner email to invite.'; return; }
    inviting = true;
    const result = await apiFetch<{ invitation_id: string; expires_at: string; invite_path: string }>(
      `/api/v1/groups/${groupId}/invitations`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail.trim() }) },
      'Could not create invitation',
    );
    if (result.ok) {
      // The backend may return its legacy invitation path while the product
      // surface remains /groups/join. Preserve the token and use that stable
      // page URL for copied links.
      const returned = new URL(result.data.invite_path, typeof window === 'undefined' ? 'https://studyus.invalid' : window.location.origin);
      invitePath = `/groups/join?token=${encodeURIComponent(returned.searchParams.get('token') ?? '')}`;
      inviteEmail = '';
    } else inviteError = result.error;
    inviting = false;
  }

  async function copyInvite() {
    if (!invitePath) return;
    const value = new URL(invitePath, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      window.setTimeout(() => (copied = false), 2500);
    } catch {
      inviteError = 'Copy was unavailable. Select the invitation link below.';
    }
  }

  function startResourceEdit(resource: GroupResource) {
    resourceEditing = resource.id;
    resourceLabel = resource.label;
    resourceUrl = resource.url;
    resourceError = null;
  }

  function clearResourceForm() {
    resourceEditing = null;
    resourceLabel = '';
    resourceUrl = '';
    resourceError = null;
  }

  async function saveResource(event: SubmitEvent) {
    event.preventDefault();
    resourceError = null;
    const label = resourceLabel.trim();
    const url = safeWebUrl(resourceUrl.trim());
    if (!label) { resourceError = 'Enter a resource label.'; return; }
    if (!url) { resourceError = 'Use an HTTP or HTTPS URL without embedded credentials.'; return; }
    resourceSaving = true;
    const editing = resourceEditing;
    const result = await apiFetch<GroupResource>(
      editing ? `/api/v1/groups/${groupId}/resources/${editing}` : `/api/v1/groups/${groupId}/resources`,
      { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, url }) },
      editing ? 'Could not update resource' : 'Could not add resource',
    );
    if (result.ok && data) {
      const resources = data.resources ?? [];
      data = normalizeData({ ...data, resources: editing ? resources.map((item) => item.id === editing ? result.data : item) : [...resources, result.data] });
      clearResourceForm();
    } else if (!result.ok) resourceError = result.error;
    resourceSaving = false;
  }

  async function removeResource(resource: GroupResource) {
    if (!window.confirm(`Delete ${resource.label}?`)) return;
    const result = await apiFetch(`/api/v1/groups/${groupId}/resources/${resource.id}`, { method: 'DELETE' }, 'Could not delete resource');
    if (result.ok && data) data = normalizeData({ ...data, resources: (data.resources ?? []).filter((item) => item.id !== resource.id) });
    else if (!result.ok) setMutationError(result.error);
  }

  function formatBytes(value: number | null | undefined): string {
    if (!value) return '';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  async function uploadFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    uploading = true;
    fileError = null;
    const form = new FormData();
    form.append('file', file);
    const result = await apiFetch<GroupFile>(`/api/v1/groups/${groupId}/files`, { method: 'POST', body: form }, 'Could not upload file');
    if (result.ok && data) data = normalizeData({ ...data, files: [...(data.files ?? []), result.data] });
    else if (!result.ok) fileError = result.error;
    uploading = false;
  }

  async function copyPrivateAttachment(event: SubmitEvent) {
    event.preventDefault();
    copyError = null;
    const id = attachmentId.trim();
    if (!id) {
      copyError = 'Choose a private attachment to copy.';
      return;
    }
    copyingAttachment = true;
    const result = await apiFetch<GroupFile>(
      `/api/v1/groups/${groupId}/files/copy`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attachment_id: id }) },
      'Could not copy attachment',
    );
    if (result.ok && data) {
      data = normalizeData({ ...data, files: [...(data.files ?? []), result.data] });
      attachmentId = '';
    } else if (!result.ok) copyError = result.error;
    copyingAttachment = false;
  }

  async function removeFile(file: GroupFile) {
    if (!window.confirm(`Delete ${file.filename}?`)) return;
    const result = await apiFetch(`/api/v1/groups/${groupId}/files/${file.id}`, { method: 'DELETE' }, 'Could not delete file');
    if (result.ok && data) data = normalizeData({ ...data, files: (data.files ?? []).filter((item) => item.id !== file.id) });
    else if (!result.ok) setMutationError(result.error);
  }

  function localDateTime(value: string, timezone?: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    if (timezone) {
      try {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
        const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
      } catch {
        // A historical event may carry a removed timezone. Fall back to the
        // browser zone so editing still gives the user a usable input.
      }
    }
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function startEventEdit(event: GroupEvent) {
    eventEditing = event.id;
    eventTitle = event.title;
    eventStarts = localDateTime(event.starts_at, event.timezone);
    eventEnds = localDateTime(event.ends_at, event.timezone);
    eventTimezone = event.timezone || currentTimezone();
    eventError = null;
  }

  function clearEventForm() {
    eventEditing = null;
    eventTitle = '';
    eventStarts = '';
    eventEnds = '';
    eventTimezone = currentTimezone();
    eventError = null;
  }

  async function saveEvent(event: SubmitEvent) {
    event.preventDefault();
    eventError = null;
    const title = eventTitle.trim();
    const starts = new Date(eventStarts);
    const ends = new Date(eventEnds);
    if (!title) { eventError = 'Enter an event title.'; return; }
    if (!eventStarts || Number.isNaN(starts.getTime()) || !eventEnds || Number.isNaN(ends.getTime())) { eventError = 'Enter a start and end time.'; return; }
    if (ends <= starts) { eventError = 'The end time must be after the start time.'; return; }
    eventSaving = true;
    const editing = eventEditing;
    const result = await apiFetch<GroupEvent>(
      editing ? `/api/v1/groups/${groupId}/events/${editing}` : `/api/v1/groups/${groupId}/events`,
      { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, starts_at: starts.toISOString(), ends_at: ends.toISOString(), timezone: eventTimezone || currentTimezone() }) },
      editing ? 'Could not update event' : 'Could not create event',
    );
    if (result.ok && data) {
      const events = data.events ?? [];
      data = normalizeData({ ...data, events: editing ? events.map((item) => item.id === editing ? { ...item, ...result.data } : item) : [...events, result.data] });
      clearEventForm();
    } else if (!result.ok) eventError = result.error;
    eventSaving = false;
  }

  async function cancelEvent(event: GroupEvent) {
    if (!window.confirm(`Cancel ${event.title}?`)) return;
    const result = await apiFetch(`/api/v1/groups/${groupId}/events/${event.id}`, { method: 'DELETE' }, 'Could not cancel event');
    if (result.ok && data) data = normalizeData({ ...data, events: (data.events ?? []).map((item) => item.id === event.id ? { ...item, state: 'cancelled' } : item) });
    else if (!result.ok) setMutationError(result.error);
  }

  async function rsvp(event: GroupEvent, response: 'going' | 'maybe' | 'declined') {
    const result = await apiFetch<{ event_id: string; response: string }>(
      `/api/v1/groups/${groupId}/events/${event.id}/rsvp`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response }) },
      'Could not update RSVP',
    );
    if (result.ok && data) data = normalizeData({ ...data, events: (data.events ?? []).map((item) => item.id === event.id ? { ...item, response } : item) });
    else if (!result.ok) setMutationError(result.error);
  }

  async function removeMember(member: GroupMember) {
    if (!member.member_id || !window.confirm(`${member.member_id === viewerUserId ? 'Leave' : 'Remove'} ${member.label ?? member.name ?? 'this member'}?`)) return;
    const result = await apiFetch(`/api/v1/groups/${groupId}/members/${member.member_id}`, { method: 'DELETE' }, 'Could not update membership');
    if (result.ok && data) data = normalizeData({ ...data, members: (data.members ?? []).filter((item) => item.member_id !== member.member_id) });
    else if (!result.ok) setMutationError(result.error);
  }

  function authorLabel(label: string | null | undefined): string { return label?.trim() || 'Deleted user'; }
  function canEditContribution(canEdit?: boolean): boolean {
    return !readOnly && canEdit !== false;
  }
  function canDeleteContribution(canDelete?: boolean): boolean {
    return !readOnly && canDelete !== false;
  }
  function formatEvent(event: GroupEvent): string {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: event.timezone }).format(new Date(event.starts_at));
    } catch {
      return new Date(event.starts_at).toLocaleString();
    }
  }
</script>

<div class="group-detail">
  {#if loading}
    <p class="status" role="status" aria-live="polite">Loading group…</p>
  {:else if error}
    <div class="state-card" role="alert"><p>{error}</p><button class="button secondary" type="button" onclick={loadGroup}>Try again</button></div>
  {:else if data}
    <header class="group-header">
      <div>
        <a class="back-link" href="/groups">← Groups</a>
        <h1>{data.group.name}</h1>
        <p class="lede">Invite-only learning shared with the members you choose.</p>
      </div>
      <span class:read-only={readOnly} class="state-badge">{readOnly ? 'Read-only' : 'Active group'}</span>
    </header>

    {#if readOnly}
      <div class="notice" role="status"><strong>Read-only group.</strong> This group is read-only because the owner is no longer available. You can keep its shared links, files, and past sessions.</div>
    {/if}
    {#if mutationError}<div class="mutation-feedback" role="alert"><span>{mutationError}</span><button class="text-button" type="button" onclick={loadGroup}>Refresh group</button></div>{/if}

    <div class="columns">
      <section class="panel members-panel" aria-labelledby="members-title">
        <div class="panel-heading"><h2 id="members-title">Members</h2><span class="count">{data.members?.length ?? 0}</span></div>
        {#if (data.members ?? []).length === 0}
          <p class="muted">No member list is available yet.</p>
        {:else}
          <ul class="member-list">
            {#each data.members ?? [] as member}
              <li>
                <span class="avatar" aria-hidden="true">{authorLabel(member.label ?? member.name).slice(0, 1).toUpperCase()}</span>
                <span class="member-copy"><strong>{authorLabel(member.label ?? member.name)}</strong><span>{member.role === 'owner' ? 'Owner' : 'Member'}</span></span>
                {#if isOwner && member.role !== 'owner'}<button class="text-button danger" type="button" onclick={() => removeMember(member)}>Remove</button>{/if}
                {#if !isOwner && member.member_id === viewerUserId}<button class="text-button danger" type="button" onclick={() => removeMember(member)}>Leave group</button>{/if}
              </li>
            {/each}
          </ul>
        {/if}
        <form class="invite-form" onsubmit={inviteMember}>
          <label for="invite-email">Owner email</label>
          <div class="form-row"><input id="invite-email" type="email" autocomplete="email" placeholder="learner@example.com" bind:value={inviteEmail} aria-invalid={inviteError ? 'true' : 'false'} disabled={readOnly || !isOwner} /><button class="button secondary" type="submit" disabled={readOnly || !isOwner || inviting}>{inviting ? 'Inviting…' : 'Invite member'}</button></div>
          {#if inviteError}<p class="error" role="alert">{inviteError}</p>{/if}
          {#if invitePath}<div class="invite-result"><label for="invite-link">Invitation link</label><div class="form-row"><input id="invite-link" readonly value={new URL(invitePath, typeof window === 'undefined' ? 'https://studyus.invalid' : window.location.origin).href} /><button class="button secondary" type="button" onclick={copyInvite}>{copied ? 'Copied' : 'Copy link'}</button></div><small>Expires in 7 days and only works for that verified email.</small></div>{/if}
        </form>
      </section>

      <section class="panel" aria-labelledby="resources-title">
        <div class="panel-heading"><h2 id="resources-title">Shared resources</h2><span class="count">{data.resources?.length ?? 0}</span></div>
        <form class="stack-form" onsubmit={saveResource} novalidate>
          <div class="form-row fields"><div><label for="resource-label">Resource label</label><input id="resource-label" type="text" maxlength="200" bind:value={resourceLabel} aria-invalid={resourceError ? 'true' : 'false'} disabled={readOnly} /></div><div><label for="resource-url">Resource URL</label><input id="resource-url" type="url" inputmode="url" placeholder="https://…" bind:value={resourceUrl} aria-invalid={resourceError ? 'true' : 'false'} disabled={readOnly} /></div></div>
          <div class="form-actions"><button class="button primary" type="submit" disabled={readOnly || resourceSaving}>{resourceSaving ? 'Saving…' : resourceEditing ? 'Save resource' : 'Add resource'}</button>{#if resourceEditing}<button class="button secondary" type="button" onclick={clearResourceForm}>Cancel edit</button>{/if}</div>
          {#if resourceError}<p class="error" role="alert">{resourceError}</p>{/if}
        </form>
        {#if (data.resources ?? []).length === 0}<p class="muted empty-copy">No shared resources yet.</p>{:else}<ul class="resource-list">{#each data.resources ?? [] as resource (resource.id)}<li><div class="item-copy">{#if safeWebUrl(resource.url)}<a href={safeWebUrl(resource.url) ?? undefined} target="_blank" rel="noopener noreferrer">{resource.label}</a>{:else}<strong>{resource.label}</strong><small>Link unavailable.</small>{/if}<span>Shared by {authorLabel(resource.author_label)}</span></div><div class="item-actions">{#if canEditContribution(resource.can_edit)}<button class="text-button" type="button" onclick={() => startResourceEdit(resource)}>Edit</button>{/if}{#if canDeleteContribution(resource.can_delete)}<button class="text-button danger" type="button" onclick={() => removeResource(resource)}>Delete</button>{/if}</div></li>{/each}</ul>{/if}
      </section>

      <section class="panel" aria-labelledby="files-title">
        <div class="panel-heading"><h2 id="files-title">Files</h2><span class="count">{data.files?.length ?? 0}</span></div>
        <div class="upload-row"><label class="button secondary" class:disabled={readOnly || uploading}> <span>{uploading ? 'Uploading…' : 'Upload file'}</span><input bind:this={fileInputEl} type="file" onchange={uploadFile} disabled={readOnly || uploading} hidden /></label><small>Private to this group · up to 10 MB</small></div>
        {#if fileError}<p class="error" role="alert">{fileError}</p>{/if}
        <form class="copy-form" onsubmit={copyPrivateAttachment} novalidate>
          <label for="private-course">Copy a private file</label>
          {#if coursesLoading}
            <p class="status" role="status" aria-live="polite">Loading your courses…</p>
          {:else if coursesError}
            <p class="error" role="alert">{coursesError}</p>
            <button class="text-button" type="button" onclick={() => void loadPrivateCourses()}>Retry courses</button>
          {:else if courses.length === 0}
            <p class="muted empty-copy">No courses are available for private files.</p>
          {:else}
            <select id="private-course" aria-label="Private course" value={selectedCourseId} onchange={handleCourseChange} disabled={readOnly || copyingAttachment}>
              <option value="">Choose a course…</option>
              {#each courses as course (course.id)}<option value={course.id}>{course.code} · {course.title}</option>{/each}
            </select>
            {#if selectedCourseId}
              <label for="private-attachment">Private file</label>
              {#if attachmentsLoading}
                <p class="status" role="status" aria-live="polite">Loading private files…</p>
              {:else if attachmentsError}
                <p class="error" role="alert">{attachmentsError}</p>
                <button class="text-button" type="button" onclick={() => void loadPrivateAttachments(selectedCourseId)}>Retry private files</button>
              {:else if privateAttachments.length === 0}
                <p class="muted empty-copy">No private attachments in this course yet.</p>
              {:else}
                <select id="private-attachment" aria-label="Private file" value={attachmentId} onchange={handleAttachmentChange} disabled={readOnly || copyingAttachment}>
                  <option value="">Choose a file…</option>
                  {#each privateAttachments as attachment (attachment.attachment_id)}<option value={attachment.attachment_id}>{attachment.filename}{attachment.size_bytes ? ` · ${formatBytes(attachment.size_bytes)}` : ''}</option>{/each}
                </select>
              {/if}
            {/if}
          {/if}
          <small class="muted">Choose one of your files; the group receives an independent copy.</small>
          <button class="button secondary" type="submit" disabled={readOnly || copyingAttachment || !attachmentId.trim()}>{copyingAttachment ? 'Copying…' : 'Copy to group'}</button>
          {#if copyError}<p class="error" role="alert">{copyError}</p>{/if}
        </form>
        {#if (data.files ?? []).length === 0}<p class="muted empty-copy">No shared files yet.</p>{:else}<ul class="file-list">{#each data.files ?? [] as file (file.id)}<li><div class="item-copy"><a href={`/api/v1/groups/${groupId}/files/${file.id}`} target="_blank" rel="noopener">{file.filename}</a><span>{formatBytes(file.size_bytes)} · Shared by {authorLabel(file.author_label)}</span></div>{#if canDeleteContribution(file.can_delete)}<button class="text-button danger" type="button" onclick={() => removeFile(file)}>Delete</button>{/if}</li>{/each}</ul>{/if}
      </section>

      <section class="panel events-panel" aria-labelledby="events-title">
        <div class="panel-heading"><h2 id="events-title">Sessions</h2><span class="count">{data.events?.length ?? 0}</span></div>
        <form class="stack-form" onsubmit={saveEvent} novalidate>
          <div><label for="event-title">Session title</label><input id="event-title" type="text" maxlength="200" bind:value={eventTitle} aria-invalid={eventError ? 'true' : 'false'} disabled={readOnly} /></div>
          <div class="form-row fields"><div><label for="event-start">Starts</label><input id="event-start" type="datetime-local" bind:value={eventStarts} aria-invalid={eventError ? 'true' : 'false'} disabled={readOnly} /></div><div><label for="event-end">Ends</label><input id="event-end" type="datetime-local" bind:value={eventEnds} aria-invalid={eventError ? 'true' : 'false'} disabled={readOnly} /></div></div>
          <p class="timezone-note">Times use your current timezone: <strong>{eventTimezone}</strong></p>
          <div class="form-actions"><button class="button primary" type="submit" disabled={readOnly || eventSaving}>{eventSaving ? 'Saving…' : eventEditing ? 'Save session' : 'Create session'}</button>{#if eventEditing}<button class="button secondary" type="button" onclick={clearEventForm}>Cancel edit</button>{/if}</div>
          {#if eventError}<p class="error" role="alert">{eventError}</p>{/if}
        </form>
        {#if (data.events ?? []).length === 0}<p class="muted empty-copy">No sessions scheduled yet.</p>{:else}<ul class="event-list">{#each data.events ?? [] as event (event.id)}<li class:cancelled={event.state === 'cancelled'}><div class="item-copy"><strong>{event.title}</strong><time datetime={event.starts_at}>{formatEvent(event)}</time><span>{event.timezone} · Hosted by {authorLabel(event.host_label)}</span>{#if event.state === 'cancelled'}<small>Cancelled</small>{/if}</div>{#if event.state !== 'cancelled'}<div class="event-controls"><div class="rsvp-buttons" role="group" aria-label={`RSVP for ${event.title}`}>{#each [['going', 'Going'], ['maybe', 'Maybe'], ['declined', 'Declined']] as option}<button class:chosen={(event.response ?? event.rsvp) === option[0]} type="button" aria-pressed={(event.response ?? event.rsvp) === option[0] ? 'true' : 'false'} aria-label={`${option[1]} for ${event.title}`} onclick={() => rsvp(event, option[0] as 'going' | 'maybe' | 'declined')}>{option[1]}</button>{/each}</div><div class="item-actions">{#if canEditContribution(event.can_edit)}<button class="text-button" type="button" onclick={() => startEventEdit(event)}>Edit</button>{/if}{#if canDeleteContribution(event.can_cancel)}<button class="text-button danger" type="button" onclick={() => cancelEvent(event)}>Cancel</button>{/if}</div></div>{/if}</li>{/each}</ul>{/if}
      </section>
    </div>
  {/if}
</div>

<style>
  .group-detail { max-width: 1120px; margin: 0 auto; display: grid; gap: 1.4rem; }
  h1, h2, p { margin: 0; }
  h1 { margin-top: .35rem; }
  h2 { font: 650 1rem/1.2 var(--font-title, var(--font-body)); }
  .group-header, .panel-heading, .form-row, .form-actions, .upload-row, .item-actions, .event-controls { display: flex; align-items: center; }
  .group-header { justify-content: space-between; gap: 1rem; }
  .back-link { color: var(--muted); font-size: .82rem; text-decoration: none; }
  .lede, .muted, .timezone-note { color: var(--muted); margin-top: .45rem; font-size: .88rem; line-height: 1.45; }
  .state-badge { padding: .35rem .55rem; border-radius: 999px; color: var(--accent-ink); background: var(--accent-soft); font-size: .72rem; font-weight: 650; white-space: nowrap; }
  .state-badge.read-only { color: var(--muted); background: var(--surface-2); }
  .notice { padding: .8rem 1rem; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); font-size: .88rem; line-height: 1.45; }
  .notice strong { color: var(--accent-ink); }
  .error { color: var(--danger); font-size: .82rem; line-height: 1.4; }
  .mutation-feedback { display: flex; align-items: center; justify-content: space-between; gap: .8rem; padding: .7rem .85rem; border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--danger) 8%, var(--surface)); color: var(--danger); font-size: .82rem; }
  .columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; align-items: start; }
  .panel, .state-card { min-width: 0; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--surface); }
  .panel-heading { justify-content: space-between; gap: .5rem; margin-bottom: .85rem; }
  .count { color: var(--muted); font: 600 .75rem var(--font-mono); }
  .member-list, .resource-list, .file-list, .event-list { list-style: none; padding: 0; margin: 0; display: grid; gap: .55rem; }
  .member-list li, .resource-list li, .file-list li, .event-list li { display: flex; align-items: center; gap: .7rem; min-width: 0; padding: .65rem 0; border-top: 1px solid var(--hairline); }
  .member-list li:first-child, .resource-list li:first-child, .file-list li:first-child, .event-list li:first-child { border-top: 0; }
  .avatar { display: grid; place-items: center; flex: none; }
  .avatar { width: 2rem; height: 2rem; border-radius: 50%; color: var(--accent-ink); background: var(--accent-soft); font-size: .78rem; font-weight: 700; }
  .member-copy, .item-copy { display: grid; gap: .16rem; min-width: 0; flex: 1; }
  .member-copy span, .item-copy span, .item-copy small { color: var(--muted); font-size: .75rem; }
  .item-copy a { color: var(--accent); overflow-wrap: anywhere; font-weight: 650; text-decoration: none; }
  .item-copy strong { overflow-wrap: anywhere; }
  .stack-form, .invite-form, .copy-form { display: grid; gap: .6rem; }
  .form-row { gap: .55rem; }
  .fields > div { flex: 1; min-width: 0; display: grid; gap: .35rem; }
  label { color: var(--muted); font-size: .75rem; font-weight: 650; }
  input, select { width: 100%; min-width: 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text); padding: .58rem .65rem; font: inherit; }
  input:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  input:disabled, select:disabled { opacity: .65; }
  .button, .text-button { border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); padding: .58rem .75rem; font: 600 .78rem/1 var(--font-title, var(--font-body)); cursor: pointer; text-decoration: none; white-space: nowrap; }
  .button.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-contrast); }
  .button:disabled, .button.disabled { opacity: .5; cursor: not-allowed; }
  .form-actions { gap: .5rem; flex-wrap: wrap; }
  .text-button { border-color: transparent; padding: .35rem .4rem; color: var(--accent); }
  .text-button.danger { color: var(--danger); }
  .text-button:hover { text-decoration: underline; }
  .empty-copy { padding: .7rem 0 .2rem; }
  .invite-result { display: grid; gap: .35rem; margin-top: .3rem; }
  .invite-result small { color: var(--muted); font-size: .72rem; }
  .copy-form { margin-top: 1rem; padding-top: .9rem; border-top: 1px solid var(--hairline); }
  .copy-form small { font-size: .72rem; }
  .upload-row { flex-wrap: wrap; gap: .6rem; }
  .upload-row small { color: var(--muted); font-size: .72rem; }
  .upload-row label { cursor: pointer; }
  .upload-row label.disabled { cursor: not-allowed; }
  .event-list li { align-items: flex-start; }
  .event-list li.cancelled { opacity: .7; }
  .event-controls { align-items: flex-end; flex-direction: column; gap: .4rem; }
  .rsvp-buttons { display: flex; flex-wrap: wrap; gap: .2rem; }
  .rsvp-buttons button { border: 1px solid var(--border); border-radius: 999px; background: var(--surface); color: var(--muted); padding: .34rem .5rem; font-size: .7rem; cursor: pointer; }
  .rsvp-buttons button.chosen { border-color: var(--accent); background: var(--accent-soft); color: var(--accent-ink); font-weight: 650; }
  .status { color: var(--muted); }
  @media (max-width: 760px) {
    .columns { grid-template-columns: 1fr; }
    .group-header { align-items: flex-start; flex-direction: column; }
  }
  @media (max-width: 520px) {
    .form-row.fields { align-items: stretch; flex-direction: column; }
    .form-row:not(.fields) { align-items: stretch; flex-direction: column; }
    .event-list li { flex-direction: column; }
    .event-controls { align-items: stretch; width: 100%; }
  }
</style>
