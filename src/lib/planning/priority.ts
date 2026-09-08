/** Shared deterministic ordering. Missing learning evidence never means low mastery. */
export type PlanningPriority = { id: string; priority?: number; deadline?: number | null; mastery?: number | null };
export function comparePlanningPriority(a: PlanningPriority, b: PlanningPriority): number {
  return (b.priority ?? 1) - (a.priority ?? 1)
    || (a.deadline ?? Infinity) - (b.deadline ?? Infinity)
    || (a.mastery ?? 100) - (b.mastery ?? 100)
    || a.id.localeCompare(b.id);
}

export function priorityReasons(item: PlanningPriority): string[] {
  return [
    ...(item.priority === 2 ? ['Marked high priority'] : []),
    ...(item.deadline != null ? ['Upcoming deadline'] : []),
    ...(item.mastery != null ? ['Based on recorded learning evidence'] : []),
    ...(item.deadline == null && item.mastery == null && item.priority !== 2 ? ['Fits your available study time'] : []),
  ];
}
