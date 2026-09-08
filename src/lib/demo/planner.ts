import { schedulePlan, type Availability, type Interval } from '../planning/engine';

const DEFAULT_SESSION_MINUTES = 25;
const DEFAULT_START_MINUTE = 9 * 60;
const DEFAULT_END_MINUTE = 21 * 60;

export type DemoTopic = {
  name: string;
  prereq_refs?: string[];
  template_ref?: string;
};

export type DemoCourse = {
  code: string;
  title: string;
  branches: Array<{ name: string; kcs: DemoTopic[] }>;
};

export type DemoDeadline = {
  id: string;
  title: string;
  dueAt: number;
  topicRefs: string[];
  weight?: number | null;
};

export type DemoPlanItem = {
  id: string;
  title: string;
  branch: string;
  minutes: number;
  start: number;
  end: number;
  deadline: number | null;
  deadlineTitle: string | null;
  reasons: string[];
};

export type DemoUnplacedItem = {
  id: string;
  title: string;
  branch: string;
  minutes: number;
  reason: string;
};

export type DemoPlan = {
  recommendation: DemoPlanItem | null;
  scheduled: DemoPlanItem[];
  unplaced: DemoUnplacedItem[];
  rationale: string;
  capacityMinutes: number;
  topicCount: number;
  unmatchedRefs: string[];
};

export type DemoPlanInput = {
  course: DemoCourse | null | undefined;
  weeklyHours: number;
  timezone?: string;
  availability?: Availability[];
  busy?: Interval[];
  deadlines?: DemoDeadline[];
  now?: number;
};

type TopicRecord = DemoTopic & {
  id: string;
  branch: string;
  order: number;
  prereqIds: string[];
};

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, ' ');
}

function stableTopicId(name: string, index: number): string {
  const slug = normalized(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'topic';
  return `topic-${String(index + 1).padStart(4, '0')}-${slug}`;
}

function defaultAvailability(): Availability[] {
  return [1, 2, 3, 4, 5].map((day) => ({ day, startMinute: DEFAULT_START_MINUTE, endMinute: DEFAULT_END_MINUTE }));
}

function safeTimezone(value: string | undefined): string {
  if (!value) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value;
  } catch {
    return 'UTC';
  }
}

function flattenTopics(course: DemoCourse | null | undefined): TopicRecord[] {
  if (!course) return [];
  const records: TopicRecord[] = [];
  for (const branch of course.branches) {
    for (const topic of branch.kcs) {
      const order = records.length;
      records.push({ ...topic, id: stableTopicId(topic.name, order), branch: branch.name, order, prereqIds: [] });
    }
  }

  const byRef = new Map<string, string>();
  for (const topic of records) {
    byRef.set(normalized(topic.name), topic.id);
    if (topic.template_ref) byRef.set(normalized(topic.template_ref), topic.id);
  }
  for (const topic of records) {
    topic.prereqIds = [...new Set((topic.prereq_refs ?? [])
      .map((reference) => byRef.get(normalized(reference)))
      .filter((id): id is string => Boolean(id)))];
  }
  return records;
}

function firstExplicitPrerequisite(topic: TopicRecord, byId: Map<string, TopicRecord>): TopicRecord {
  let current = topic;
  const seen = new Set<string>();
  while (current.prereqIds.length > 0 && !seen.has(current.id)) {
    seen.add(current.id);
    const prerequisite = byId.get(current.prereqIds[0]);
    if (!prerequisite) break;
    current = prerequisite;
  }
  return current;
}

function deadlineFor(topic: TopicRecord, deadlines: DemoDeadline[], byRef: Map<string, TopicRecord>): { deadline: number | null; title: string | null } {
  const matching = deadlines.filter((deadline) => deadline.topicRefs.some((reference) => {
    const matched = byRef.get(normalized(reference));
    return matched?.id === topic.id;
  }));
  const earliest = [...matching].sort((a, b) => a.dueAt - b.dueAt || (b.weight ?? -1) - (a.weight ?? -1) || a.id.localeCompare(b.id))[0];
  return earliest ? { deadline: earliest.dueAt, title: earliest.title } : { deadline: null, title: null };
}

function mapDeadlineRefs(deadlines: DemoDeadline[], byRef: Map<string, TopicRecord>): string[] {
  return [...new Set(deadlines.flatMap((deadline) => deadline.topicRefs.filter((reference) => !byRef.has(normalized(reference)))))];
}

function rationaleFor(
  recommendation: DemoPlanItem | null,
  unplaced: DemoUnplacedItem[],
  topics: TopicRecord[],
  capacityMinutes: number,
  deadlineTitle: string | null,
  relationTarget: string | null,
): string {
  if (!topics.length) return 'Add at least one topic to your course map before opening a preview.';
  if (!recommendation) {
    return unplaced[0]?.reason === 'Set your study availability first'
      ? 'Set at least one preview availability window before scheduling a session.'
      : unplaced[0]?.reason === 'Weekly study capacity is too small for this session'
        ? `Your ${capacityMinutes}-minute weekly preview capacity is too small for a ${DEFAULT_SESSION_MINUTES}-minute session.`
        : 'No supplied topic fits the available preview time before its deadline.';
  }
  if (deadlineTitle && relationTarget) {
    return `Your map explicitly places ${recommendation.title} before ${relationTarget}; ${deadlineTitle} keeps this work in the preview first.`;
  }
  if (deadlineTitle) return `${deadlineTitle} is the supplied deadline driving this preview order.`;
  if (relationTarget) return `Your course map explicitly places ${recommendation.title} before ${relationTarget}, so the preview starts there.`;
  return `Starts with the first topic in your supplied course map and fits ${capacityMinutes} minutes of weekly preview capacity.`;
}

/**
 * Builds a deterministic, local-only study preview from learner supplied
 * topics. No mastery, grade, deadline, or prerequisite is created here. A
 * deadline or relationship affects the result only when it was supplied by
 * the caller; otherwise the authored map order is the tie-breaker.
 */
export function planDemo(input: DemoPlanInput): DemoPlan {
  const topics = flattenTopics(input.course);
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const byReference = new Map<string, TopicRecord>();
  for (const topic of topics) {
    byReference.set(normalized(topic.name), topic);
    if (topic.template_ref) byReference.set(normalized(topic.template_ref), topic);
  }
  const deadlines = input.deadlines ?? [];
  const unmatchedRefs = mapDeadlineRefs(deadlines, byReference);
  const capacityMinutes = Math.max(0, Math.floor(input.weeklyHours * 60));
  const availability = input.availability ?? defaultAvailability();
  const now = input.now ?? Date.now();

  if (!topics.length) {
    return { recommendation: null, scheduled: [], unplaced: [], rationale: rationaleFor(null, [], topics, capacityMinutes, null, null), capacityMinutes, topicCount: 0, unmatchedRefs };
  }

  const candidates = topics.map((topic) => {
    const prerequisite = firstExplicitPrerequisite(topic, byId);
    return {
      id: prerequisite.id,
      title: prerequisite.name,
      branch: prerequisite.branch,
      minutes: DEFAULT_SESSION_MINUTES,
    };
  });

  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  const deadlineByTopic = new Map<string, { deadline: number | null; title: string | null }>();
  for (const candidate of uniqueCandidates) {
    const deadline = deadlineFor(byId.get(candidate.id)!, deadlines, byReference);
    const source = topics.find((topic) => firstExplicitPrerequisite(topic, byId).id === candidate.id);
    const inherited = deadline.deadline === null && source ? deadlineFor(source, deadlines, byReference) : deadline;
    deadlineByTopic.set(candidate.id, inherited);
  }

  const result = schedulePlan({
    now,
    timezone: safeTimezone(input.timezone),
    availability,
    weeklyMinutes: capacityMinutes,
    busy: [...(input.busy ?? [])],
    items: uniqueCandidates.map((candidate) => {
      const deadline = deadlineByTopic.get(candidate.id);
      return {
        id: candidate.id,
        title: candidate.title,
        minutes: candidate.minutes,
        deadline: deadline?.deadline,
        priority: deadline?.deadline === null || deadline?.deadline === undefined ? undefined : 1,
      };
    }),
  });

  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const toPlanItem = (item: (typeof result.scheduled)[number]): DemoPlanItem => {
    const topic = topicById.get(item.id);
    const deadline = deadlineByTopic.get(item.id) ?? { deadline: null, title: null };
    return {
      id: item.id,
      title: item.title ?? topic?.name ?? item.id,
      branch: topic?.branch ?? 'Course map',
      minutes: item.minutes,
      start: item.start,
      end: item.end,
      deadline: deadline.deadline,
      deadlineTitle: deadline.title,
      reasons: item.reasons,
    };
  };
  const scheduled = result.scheduled.map(toPlanItem);
  const unplaced = result.unplaced.map((item) => ({
    id: item.id,
    title: item.title ?? topicById.get(item.id)?.name ?? item.id,
    branch: topicById.get(item.id)?.branch ?? 'Course map',
    minutes: item.minutes,
    reason: item.reason,
  }));
  const recommendation = scheduled[0] ?? null;
  const recommendationTopic = recommendation ? topicById.get(recommendation.id) : null;
  const relatedTarget = recommendation
    ? topics.find((topic) => topic.id !== recommendation.id && firstExplicitPrerequisite(topic, byId).id === recommendation.id)?.name ?? null
    : null;
  const recommendationDeadline = recommendation?.deadlineTitle ?? null;

  return {
    recommendation,
    scheduled,
    unplaced,
    rationale: rationaleFor(recommendation, unplaced, topics, capacityMinutes, recommendationDeadline, relatedTarget),
    capacityMinutes,
    topicCount: topics.length,
    unmatchedRefs,
  };
}

export function previewDateLabel(timestamp: number, timezone = 'UTC'): string {
  return new Intl.DateTimeFormat('en', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: safeTimezone(timezone) }).format(timestamp);
}
