import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import loginSource from '../../src/pages/login.astro?raw';
import signInSource from '../../src/pages/sign-in/[...path].astro?raw';
import signUpSource from '../../src/pages/sign-up/[...path].astro?raw';
import accountSource from '../../src/pages/account/[...path].astro?raw';
import authShellSource from '../../src/components/auth/AuthShell.astro?raw';
import publicTrialSource from '../../src/components/demo/PublicTrial.svelte?raw';
import resourcesSource from '../../src/pages/courses/[slug]/resources.astro?raw';
import gradesSource from '../../src/pages/grades.astro?raw';
import EventPopover from '../../src/components/planner/EventPopover.svelte';
import GradeTable from '../../src/components/admin/GradeTable.svelte';
import GroupedResource from '../../src/components/course/GroupedResource.svelte';
import PublicTrial from '../../src/components/demo/PublicTrial.svelte';
import { apiFetch } from '../../src/lib/apiClient';
import type { CalendarItem } from '../../src/lib/types/calendar';

vi.mock('../../src/lib/apiClient', () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

describe('task9 auth route polish', () => {
  it('uses one canonical auth surface and keeps login as a redirect alias', () => {
    expect(loginSource).not.toContain('<SignIn');
    expect(loginSource).toContain('/sign-in');
    expect(loginSource).toContain('safeReturnPath');
    expect(signInSource).toContain('AuthShell');
    expect(signUpSource).toContain('AuthShell');
    expect(accountSource).toContain("import AppShell from '../../layouts/AppShell.astro'");
    expect(accountSource).toContain('<AppShell');
    expect(authShellSource).toContain('aria-busy');
    expect(authShellSource).toContain('MutationObserver');
    expect(authShellSource).toContain('role="alert"');
    expect(authShellSource).toContain('Try again');
  });
});

describe('task9 public trial semantics', () => {
  it('keeps setup fields named, choices pressed, recovery explicit, and mobile reset available', () => {
    expect(publicTrialSource).toContain('aria-label="Search reviewed courses"');
    expect(publicTrialSource).toContain('aria-label="Course code"');
    expect(publicTrialSource).toContain('aria-label="Course title"');
    expect(publicTrialSource).toContain('aria-label="Course topics"');
    expect(publicTrialSource).toContain('aria-pressed={guidance === option[0]}');
    expect(publicTrialSource).toContain('aria-pressed={depth === option[0]}');
    expect(publicTrialSource).toContain('No reviewed courses match');
    expect(publicTrialSource).toContain('Back');
    expect(publicTrialSource).toContain('mobile-reset');
    expect(publicTrialSource).toContain('clearDemoDraft');
    expect(publicTrialSource).not.toContain('localStorage.clear');
    expect(PublicTrial).toBeDefined();
  });
});

describe('task9 course resource presentation', () => {
  it('groups repeated destinations while retaining concept context and distinct counts', () => {
    expect(resourcesSource).toContain('GroupedResource');
    expect(resourcesSource).toContain('unique destinations');
    expect(resourcesSource).toContain('kcHref');
    expect(resourcesSource).toContain('kcCount');
  });

  it('renders one destination card with every linked concept and row count', () => {
    const { container } = render(GroupedResource, {
      props: {
        resources: [
          { id: 'official-1', url: 'https://example.com/fluids', label: 'Fluid reference', kind: 'canonical', pinned: true },
          { id: 'shared-1', url: 'https://example.com/fluids', label: 'Fluid reference copy', kind: 'user_shared', pinned: false },
        ],
        contexts: [
          { id: 'kc-1', name: 'Bernoulli equation', href: '/courses/chee-314/kc/kc-1' },
          { id: 'kc-2', name: 'Continuity', href: '/courses/chee-314/kc/kc-2' },
        ],
      },
    });

    expect(container.querySelectorAll('.grouped-resource')).toHaveLength(1);
    expect(screen.getByText('2 links · 2 concepts')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Bernoulli equation' }).getAttribute('href')).toBe('/courses/chee-314/kc/kc-1');
    expect(screen.getByRole('link', { name: 'Continuity' }).getAttribute('href')).toBe('/courses/chee-314/kc/kc-2');
  });
});

describe('task9 grades presentation', () => {
  it('provides a course filter and focuses grade editing on an explicit row', async () => {
    expect(gradesSource).toContain('course-filter');

    apiFetchMock.mockResolvedValue({ ok: true, data: { grade_received: 82, grade_max: 100, mastery_deltas: [] } });
    render(GradeTable, {
      props: {
        courseId: 'course-1',
        courseCode: 'HIST101',
        courseTitle: 'History',
        weightedGrade: 82,
        initialAssessments: [{
          id: 'assessment-1',
          title: 'Midterm',
          type: 'quiz',
          dueDate: null,
          weightPct: 30,
          gradeReceived: 72,
          gradeMax: 100,
        }],
      },
    });

    expect(screen.queryByRole('spinbutton', { name: 'Grade received for Midterm' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit Midterm' }));
    const received = screen.getByRole('spinbutton', { name: 'Grade received for Midterm' });
    expect(received).not.toBeNull();
    await fireEvent.input(received, { target: { value: '82' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save grade for Midterm' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/v1/assessments/assessment-1',
      expect.objectContaining({ body: JSON.stringify({ grade_received: 82, grade_max: 100 }) }),
      'Save failed',
    ));
  });
});

describe('task9 desktop event popover keyboard contract', () => {
  it('returns focus to the trigger after a nonmodal desktop popover closes', async () => {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.textContent = 'Open calendar item';
    document.body.appendChild(trigger);
    trigger.focus();

    const onClose = vi.fn();
    const item: CalendarItem = {
      id: 'item-1',
      type: 'event_logged',
      title: 'Review notes',
      date: '2026-09-07T12:00:00.000Z',
      end_date: null,
      all_day: false,
      course_id: null,
      href: null,
      details: { source: 'seeded' },
    };
    const rendered = render(EventPopover, {
      props: {
        item,
        course: undefined,
        anchorRect: { x: 100, y: 100, width: 20, height: 20 },
        onClose,
        plannerLink: null,
      },
    });

    expect(rendered.container.querySelector('[aria-modal="true"]')).toBeNull();
    const closeButton = rendered.container.querySelector('.close-btn') as HTMLButtonElement | null;
    closeButton?.focus();
    expect(document.activeElement).toBe(closeButton);
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rendered.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
