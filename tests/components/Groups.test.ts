import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroupsPage from '../../src/components/groups/GroupsPage.svelte';
import GroupDetail from '../../src/components/groups/GroupDetail.svelte';
import GroupJoin from '../../src/components/groups/GroupJoin.svelte';
import { apiFetch } from '../../src/lib/apiClient';

vi.mock('../../src/lib/apiClient', () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

const activeGroup = {
  id: 'group-1',
  name: 'Physics study circle',
  state: 'active',
};

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function httpError(error: string) {
  return { ok: false as const, error, reason: 'http' as const };
}

function allowConfirm() {
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => true) });
}

beforeEach(() => apiFetchMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe('GroupsPage', () => {
  it('loads the real group list and creates a group from the labeled form', async () => {
    apiFetchMock
      .mockResolvedValueOnce(ok({ groups: [{ group: activeGroup, role: 'owner' }] }))
      .mockResolvedValueOnce(ok({ ...activeGroup, id: 'group-2', name: 'Exam prep' }));

    render(GroupsPage);

    expect(screen.getByRole('status').textContent).toContain('Loading groups');
    expect(await screen.findByRole('link', { name: /Physics study circle/ })).not.toBeNull();
    expect(screen.getByText('Physics study circle').closest('a')?.getAttribute('href')).toBe('/groups/group-1');

    await fireEvent.input(screen.getByRole('textbox', { name: 'Group name' }), { target: { value: 'Exam prep' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

    await waitFor(() => expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/api/v1/groups',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ name: 'Exam prep' }) }),
      'Could not create group',
    ));
    expect(await screen.findByRole('link', { name: /Exam prep/ })).not.toBeNull();
    expect(screen.getByRole('link', { name: /Exam prep/ }).getAttribute('href')).toBe('/groups/group-2');
  });

  it('keeps server errors inline and preserves an empty state', async () => {
    apiFetchMock.mockResolvedValueOnce(httpError('Groups are unavailable right now'));
    render(GroupsPage);
    expect((await screen.findByRole('alert')).textContent).toContain('Groups are unavailable right now');
    expect(screen.getByRole('button', { name: 'Try again' })).not.toBeNull();
  });
});

describe('GroupDetail', () => {
  it('renders ownerless groups as readable and disables write controls', async () => {
    apiFetchMock.mockResolvedValueOnce(ok({
      group: { ...activeGroup, state: 'read_only', role: 'member' },
      members: [{ member_id: 'user-2', label: 'Retained learner', role: 'member' }],
      resources: [{ id: 'resource-1', label: 'Reference', url: 'https://example.com/reference', author_label: 'Deleted user', author_deleted: true }],
      files: [],
      events: [],
    }));

    render(GroupDetail, { props: { groupId: 'group-1' } });

    expect(await screen.findByText(/read-only because the owner is no longer available/i)).not.toBeNull();
    expect(screen.getByText('Retained learner')).not.toBeNull();
    expect(screen.getByText(/Deleted user/)).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Add resource' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Invite member' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('turns the invitation response into the stable join route and keeps the recipient private', async () => {
    apiFetchMock
      .mockResolvedValueOnce(ok({
        group: { ...activeGroup, role: 'owner' },
        members: [{ member_id: 'user-1', label: 'Owner', role: 'owner' }],
        resources: [],
        files: [],
        events: [],
      }))
      .mockResolvedValueOnce(ok([{ id: 'course-1', code: 'PHY101', title: 'Physics' }]))
      .mockResolvedValueOnce(ok({ invitation_id: 'invite-1', expires_at: '2026-09-15T00:00:00.000Z', invite_path: '/groups/invitations/accept?token=single-use-token' }));

    render(GroupDetail, { props: { groupId: 'group-1', viewerUserId: 'user-1' } });
    expect((await screen.findAllByText('Owner')).length).toBeGreaterThan(0);
    await fireEvent.input(screen.getByRole('textbox', { name: 'Owner email' }), { target: { value: 'learner@example.com' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Invite member' }));

    const link = await screen.findByRole('textbox', { name: 'Invitation link' }) as HTMLInputElement;
    expect(link.value).toContain('/groups/join?token=single-use-token');
    expect(screen.getByText(/Expires in 7 days/)).not.toBeNull();
    expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/api/v1/groups/group-1/invitations',
      expect.objectContaining({ body: JSON.stringify({ email: 'learner@example.com' }) }),
      'Could not create invitation',
    );
  });

  it('rejects unsafe resource URLs in the mounted form and sends RSVP responses', async () => {
    apiFetchMock
      .mockResolvedValueOnce(ok({
        group: { ...activeGroup, role: 'member' },
        members: [],
        resources: [],
        files: [],
        events: [{ id: 'event-1', title: 'Review session', starts_at: '2026-09-08T15:00:00.000Z', ends_at: '2026-09-08T16:00:00.000Z', timezone: 'America/Toronto', state: 'scheduled', host_label: 'Owner' }],
      }))
      .mockResolvedValueOnce(ok([{ id: 'course-1', code: 'PHY101', title: 'Physics' }]))
      .mockResolvedValueOnce(ok({ event_id: 'event-1', response: 'going' }));

    render(GroupDetail, { props: { groupId: 'group-1' } });
    expect(await screen.findByText('Review session')).not.toBeNull();

    await fireEvent.input(screen.getByRole('textbox', { name: 'Resource URL' }), { target: { value: 'javascript:alert(1)' } });
    await fireEvent.input(screen.getByRole('textbox', { name: 'Resource label' }), { target: { value: 'Bad link' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add resource' }));
    expect(await screen.findByText(/HTTP or HTTPS URL/i)).not.toBeNull();
    expect(apiFetchMock).toHaveBeenCalledTimes(2);

    await fireEvent.click(screen.getByRole('button', { name: 'Going for Review session' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/api/v1/groups/group-1/events/event-1/rsvp',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ response: 'going' }) }),
      'Could not update RSVP',
    ));
  });

  it('uses member ids for owner removal and lets the current member leave', async () => {
    const ownerData = {
      group: { ...activeGroup, role: 'owner' },
      members: [
        { member_id: 'user-1', label: 'Owner', role: 'owner' },
        { member_id: 'user-2', label: 'Learner', role: 'member' },
      ],
      resources: [], files: [], events: [],
    };
    apiFetchMock
      .mockResolvedValueOnce(ok([{ id: 'course-1', code: 'PHY101', title: 'Physics' }]))
      .mockResolvedValueOnce(ok({}));
    allowConfirm();
    render(GroupDetail, { props: { groupId: 'group-1', viewerUserId: 'user-1', initialData: ownerData } });

    await fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/groups/group-1/members/user-2',
      { method: 'DELETE' },
      'Could not update membership',
    ));
    expect(screen.queryByText('Learner')).toBeNull();

    const memberData = {
      group: { ...activeGroup, role: 'member' },
      members: [
        { member_id: 'user-1', label: 'Owner', role: 'owner' },
        { member_id: 'user-2', label: 'Learner', role: 'member' },
      ],
      resources: [], files: [], events: [],
    };
    apiFetchMock
      .mockResolvedValueOnce(ok([{ id: 'course-1', code: 'PHY101', title: 'Physics' }]))
      .mockResolvedValueOnce(ok({}));
    render(GroupDetail, { props: { groupId: 'group-1', viewerUserId: 'user-2', initialData: memberData } });
    await fireEvent.click(screen.getByRole('button', { name: 'Leave group' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenLastCalledWith(
      '/api/v1/groups/group-1/members/user-2',
      { method: 'DELETE' },
      'Could not update membership',
    ));
  });

  it('loads courses and private filenames before copying the selected attachment', async () => {
    apiFetchMock
      .mockResolvedValueOnce(ok([{ id: 'course-1', code: 'PHY101', title: 'Physics' }]))
      .mockResolvedValueOnce(ok({ attachments: [{ attachment_id: 'attachment-1', filename: 'notes.pdf', size_bytes: 2048, mime_type: 'application/pdf' }] }))
      .mockResolvedValueOnce(ok({ id: 'file-1', filename: 'notes.pdf', size_bytes: 2048, author_label: 'Owner' }));
    render(GroupDetail, {
      props: {
        groupId: 'group-1',
        initialData: { group: { ...activeGroup, role: 'member' }, members: [], resources: [], files: [], events: [] },
      },
    });

    expect(screen.queryByPlaceholderText('Attachment ID')).toBeNull();
    const courseSelect = await screen.findByRole('combobox', { name: 'Private course' });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/courses', {}, 'Could not load courses');
    await fireEvent.change(courseSelect, { target: { value: 'course-1' } });
    const attachmentSelect = await screen.findByRole('combobox', { name: 'Private file' });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/courses/course-1/attachments', {}, 'Could not load private files');
    expect(screen.getByRole('option', { name: /notes\.pdf/ })).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Copy to group' }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.change(attachmentSelect, { target: { value: 'attachment-1' } });
    expect((attachmentSelect as unknown as HTMLSelectElement).value).toBe('attachment-1');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Copy to group' }) as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(screen.getByRole('button', { name: 'Copy to group' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/groups/group-1/files/copy',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ attachment_id: 'attachment-1' }) }),
      'Could not copy attachment',
    ));
    expect(await screen.findByRole('link', { name: 'notes.pdf' })).not.toBeNull();
  });

  it('shows private attachment loading errors with retry and an empty course state', async () => {
    apiFetchMock
      .mockResolvedValueOnce(httpError('Could not load courses'))
      .mockResolvedValueOnce(ok([{ id: 'course-1', code: 'PHY101', title: 'Physics' }]))
      .mockResolvedValueOnce(httpError('Could not load private attachments'))
      .mockResolvedValueOnce(ok({ attachments: [] }));
    render(GroupDetail, {
      props: {
        groupId: 'group-1',
        initialData: { group: { ...activeGroup, role: 'member' }, members: [], resources: [], files: [], events: [] },
      },
    });

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load courses');
    await fireEvent.click(screen.getByRole('button', { name: 'Retry courses' }));
    const courseSelect = await screen.findByRole('combobox', { name: 'Private course' });
    await fireEvent.change(courseSelect, { target: { value: 'course-1' } });
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load private attachments');
    await fireEvent.click(screen.getByRole('button', { name: 'Retry private files' }));
    expect(await screen.findByText('No private attachments in this course yet.')).not.toBeNull();
    expect((screen.getByRole('button', { name: 'Copy to group' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a recovery action when a moderation mutation fails', async () => {
    apiFetchMock
      .mockResolvedValueOnce(ok([{ id: 'course-1', code: 'PHY101', title: 'Physics' }]))
      .mockResolvedValueOnce(httpError('Could not delete resource right now'));
    allowConfirm();
    render(GroupDetail, {
      props: {
        groupId: 'group-1',
        initialData: {
          group: { ...activeGroup, role: 'owner' }, members: [],
          resources: [{ id: 'resource-1', label: 'Reference', url: 'https://example.com/reference', author_label: 'Owner', can_delete: true }],
          files: [], events: [],
        },
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not delete resource right now');
    expect(screen.getByRole('button', { name: 'Refresh group' })).not.toBeNull();
  });
});

describe('GroupJoin', () => {
  it('explains verified-email failures without claiming acceptance', async () => {
    apiFetchMock.mockResolvedValueOnce(httpError('This invitation is for a different verified email'));
    render(GroupJoin, { props: { token: 'invite-token' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect((await screen.findByRole('alert')).textContent).toContain('This invitation is for a different verified email');
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/groups/invitations/accept',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'invite-token' }) }),
      'Could not accept invitation',
    );
  });
});
