import type { BehavioralEventName } from './events';

export type BehavioralEventReachability = 'product_ui' | 'api_only' | 'system';

export type BehavioralEmitter = {
  id: string;
  description: string;
};

export type BehavioralCoverageEntry =
  | {
      status: 'live';
      reachability: BehavioralEventReachability;
      emitters: readonly [BehavioralEmitter, ...BehavioralEmitter[]];
    }
  | {
      status: 'reserved';
      reason: string;
      decision: string;
      emitters: readonly [];
    };

type LiveBehavioralCoverageEntry = Extract<BehavioralCoverageEntry, { status: 'live' }>;
type ReservedBehavioralCoverageEntry = Extract<BehavioralCoverageEntry, { status: 'reserved' }>;

function live(
  reachability: BehavioralEventReachability,
  ...emitters: [BehavioralEmitter, ...BehavioralEmitter[]]
): LiveBehavioralCoverageEntry {
  return { status: 'live', reachability, emitters };
}

function reserved(reason: string, decision: string): ReservedBehavioralCoverageEntry {
  return { status: 'reserved', reason, decision, emitters: [] };
}

/**
 * Exhaustive ownership and reachability classification for the approved taxonomy.
 * This registry makes catalog drift a type/test failure; it does not prove that a
 * runtime path is reachable, so emitter behavior still needs focused tests.
 */
export const behavioralEventCoverage = {
  landing_try_clicked: live('product_ui', {
    id: 'MarketingLayout.try-cta',
    description: 'The maintained marketing /try anchors capture an actual CTA activation.',
  }),
  setup_step_completed: live('product_ui', {
    id: 'PublicTrial.setup-step-complete',
    description: 'The public trial records each explicitly completed setup step.',
  }),
  setup_step_skipped: live('product_ui', {
    id: 'PublicTrial.setup-step-skip',
    description: 'The public trial records each skipped or simulated setup step.',
  }),
  demo_entered: live('product_ui', {
    id: 'PublicTrial.enter-demo',
    description: 'The public trial records entry into the interactive demo surface.',
  }),
  scenario_started: live('product_ui', {
    id: 'PublicTrial.run-scenario',
    description: 'The public trial records the start side of each scenario transition.',
  }),
  scenario_completed: live('product_ui', {
    id: 'PublicTrial.complete-scenario',
    description: 'The public trial records the completion side of each scenario transition.',
  }),
  signup_clicked: live('product_ui', {
    id: 'PublicTrial.signup-cta',
    description: 'The public trial records its authenticated-conversion CTA.',
  }),
  import_offered: live('product_ui', {
    id: 'OnboardingSetup.import-offer',
    description: 'Authenticated onboarding records presentation of a valid trial import.',
  }),
  import_accepted: live('product_ui', {
    id: 'OnboardingSetup.import-accept',
    description: 'Authenticated onboarding records acceptance of the trial handoff.',
  }),
  import_declined: live('product_ui', {
    id: 'OnboardingSetup.import-decline',
    description: 'Authenticated onboarding records decline of the trial handoff.',
  }),
  onboarding_completed: live('product_ui', {
    id: 'OnboardingSetup.demo-funnel-complete',
    description: 'The legacy demo funnel closes after authenticated onboarding succeeds.',
  }),
  page_viewed: live('system', {
    id: 'AnalyticsBootstrap.page-lifecycle',
    description: 'The deliberate layout bootstrap records one validated route-pattern page view.',
  }),
  signup_completed: live('system', {
    id: 'middleware.local-user-created',
    description: 'The Clerk bridge records only a newly created local learner row.',
  }),
  onboarding_path_chosen: live('system', {
    id: 'onboarding.commit-analytics-batch',
    description: 'A new successful course commit starts the ordered activation batch.',
  }),
  onboarding_map_reviewed: live('system', {
    id: 'onboarding.commit-analytics-batch',
    description: 'A new successful course commit records structural review counts second.',
  }),
  onboarding_completed_auth: live('system', {
    id: 'onboarding.commit-analytics-batch',
    description: 'A new successful course commit closes the ordered activation batch.',
  }),
  app_session_started: live('system', {
    id: 'AnalyticsBootstrap.session-boundary',
    description: 'The deliberate layout bootstrap records a new app-session boundary.',
  }),
  next_move_viewed: live('product_ui', {
    id: 'NextMoveCard.impression',
    description: 'The dashboard records a recommendation impression before either action.',
  }),
  recommendation_followed: live('product_ui', {
    id: 'NextMoveCard.follow',
    description: 'The Next Move primary action records follow after its impression.',
  }),
  recommendation_ignored: live('product_ui', {
    id: 'NextMoveCard.rotate',
    description: 'The Show another action records ignore after its impression.',
  }),
  task_checked: live(
    'product_ui',
    {
      id: 'tasks.store-complete',
      description: 'Maintained task toggles record a successful completion mutation.',
    },
    {
      id: 'EventPopover.task-complete',
      description: 'The planner event popover records its successful task completion mutation.',
    },
  ),
  task_dismissed: live('product_ui', {
    id: 'tasks.store-dismiss-system-task',
    description: 'Maintained controls record successful soft deletion of a system task.',
  }),
  record_event_opened: live(
    'product_ui',
    {
      id: 'LogEventModal.open',
      description: 'The full Record Event modal records one open per interaction.',
    },
    {
      id: 'QuickEventForm.open',
      description: 'The compact Record Event control records one open per interaction.',
    },
  ),
  record_event_submitted: live(
    'product_ui',
    {
      id: 'LogEventModal.submit-success',
      description: 'The full Record Event modal records a successful keyed submission.',
    },
    {
      id: 'QuickEventForm.submit-success',
      description: 'The compact Record Event control records a successful keyed submission.',
    },
  ),
  notification_opened: live('product_ui', {
    id: 'NotificationsBell.open-item',
    description: 'The notification bell records activation of a notification item.',
  }),
  resource_opened: live(
    'product_ui',
    {
      id: 'ResourceCard.open',
      description: 'Feed resource activations record their resource and origin.',
    },
    {
      id: 'ResourceTile.open',
      description: 'Course resource activations record their resource and origin.',
    },
    {
      id: 'ResourceAnalyticsLink.open',
      description: 'Shared resource links record their resource and origin.',
    },
  ),
  resource_saved: reserved(
    'No maintained action saves an already-opened resource into a course; resource creation is a different transition.',
    'Implement the intended save action and its emitter, or prune this event from the approved taxonomy.',
  ),
  practice_started: live('product_ui', {
    id: 'StudyFlow.session-start',
    description: 'StudyFlow records a newly created or validly resumed practice session.',
  }),
  practice_abandoned: live('product_ui', {
    id: 'StudyFlow.exit-or-discard',
    description: 'StudyFlow records page exit or explicit discard before completion.',
  }),
  quiz_started: live(
    'product_ui',
    {
      id: 'QuickQuiz.start',
      description: 'The standalone quick quiz records its first usable question set.',
    },
    {
      id: 'VerifyQuiz.start',
      description: 'The Absorb prerequisite quiz records its first usable question set.',
    },
  ),
  quiz_abandoned: live(
    'product_ui',
    {
      id: 'QuickQuiz.exit',
      description: 'The standalone quick quiz records exit before its terminal result.',
    },
    {
      id: 'VerifyQuiz.exit',
      description: 'The Absorb prerequisite quiz records exit before its terminal result.',
    },
  ),
  tutor_opened: live('product_ui', {
    id: 'ScaffoldChat.mount-conversation',
    description: 'The maintained tutor surface records one open per mounted conversation.',
  }),
  tutor_message_sent: live('product_ui', {
    id: 'tutorRuntime.accepted-user-turn',
    description: 'The server records a learner turn only after the Durable Object accepts it.',
  }),
  tutor_abandoned: live('system', {
    id: 'LearnerAgent.tutor-inactivity-alarm',
    description: 'The learner Durable Object records each due 30-minute inactivity episode.',
  }),
  absorb_stage_reached: live('product_ui', {
    id: 'AbsorbFlow.stage-entry',
    description: 'The Absorb flow records monotonic stage entry within a mounted visit.',
  }),
  prereq_gate_decided: live('product_ui', {
    id: 'AbsorbFlow.prerequisite-decision',
    description: 'The Absorb flow records verify or continue-anyway, including zero weak prerequisites.',
  }),
  misconception_card_shown: live('product_ui', {
    id: 'ScaffoldChat.misconception-card-render',
    description: 'The tutor records each rendered misconception card once.',
  }),
  misconception_accepted: live('product_ui', {
    id: 'ScaffoldChat.misconception-accept',
    description: 'The tutor records acceptance after the corresponding card impression.',
  }),
  misconception_dismissed: live('product_ui', {
    id: 'ScaffoldChat.misconception-dismiss',
    description: 'The tutor records dismissal after the corresponding card impression.',
  }),
  attendance_toggled: live(
    'product_ui',
    {
      id: 'AttendanceCard.status-mutation',
      description: 'The Standing attendance card records a successful status mutation.',
    },
    {
      id: 'EventPopover.attendance-mutation',
      description: 'The planner event popover records a successful attendance mutation.',
    },
  ),
  calendar_connect_started: live('product_ui', {
    id: 'calendar.connections-attempt',
    description: 'The calendar connection route records start before invoking the provider.',
  }),
  calendar_connected: live('product_ui', {
    id: 'calendar.connections-attempt',
    description: 'The calendar connection route records the successful outcome of an attempt.',
  }),
  calendar_connect_failed: live('product_ui', {
    id: 'calendar.connections-attempt',
    description: 'The calendar connection route records a sanitized failed outcome for an attempt.',
  }),
  settings_changed: live(
    'product_ui',
    {
      id: 'user.settings-mutation',
      description: 'The user settings route records changed key names after a successful mutation.',
    },
    {
      id: 'AnalyticsPrivacySettings.opt-in',
      description: 'The privacy control records opt-in only after analytics reinitializes.',
    },
  ),
  course_archived: live('api_only', {
    id: 'courses.slug-patch-archive',
    description: 'The course PATCH route records the false-to-true archive transition; no maintained UI exposes it.',
  }),
  correction_internalized: live('product_ui', {
    id: 'CorrectionsLedger.internalize',
    description: 'The correction ledger records a successful internalization action.',
  }),
} satisfies Record<BehavioralEventName, BehavioralCoverageEntry>;
