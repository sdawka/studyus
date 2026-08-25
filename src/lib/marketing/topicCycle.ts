type TopicExample = {
  courseShort: string;
  courseLong: string;
  topic: string;
  status: string;
  rankReason: string;
  meta: string;
  reasonShort: string;
};

const examples: TopicExample[] = [
  {
    courseShort: 'NURS 210',
    courseLong: 'NURS 210 · Human Physiology',
    topic: 'Renal fluid balance',
    status: 'Weak · 34%',
    rankReason: 'Ranked #1 of 7 — recall is fading, and the lab check is Thursday.',
    meta: '~18 min · prepares you for acid–base regulation next',
    reasonShort: 'fading · lab Thu',
  },
  {
    courseShort: 'COMP 202',
    courseLong: 'COMP 202 · Foundations of Programming',
    topic: 'Recursive tree traversal',
    status: 'Stale · 41%',
    rankReason: 'Ranked #1 of 8 — your last attempt stalled, and the assignment is due Friday.',
    meta: '~22 min · unlocks divide-and-conquer problems next',
    reasonShort: 'stale · due Fri',
  },
  {
    courseShort: 'ECON 230',
    courseLong: 'ECON 230 · Microeconomic Theory',
    topic: 'Consumer surplus',
    status: 'Weak · 38%',
    rankReason: 'Ranked #1 of 6 — it is your weakest assessed topic before Monday’s midterm.',
    meta: '~20 min · connects welfare loss and taxation next',
    reasonShort: 'weak · midterm Mon',
  },
  {
    courseShort: 'HIST 215',
    courseLong: 'HIST 215 · Modern Europe',
    topic: 'Treaty of Versailles',
    status: 'Recall · 46%',
    rankReason: 'Ranked #1 of 5 — the evidence is nine days old, and your essay outline needs it.',
    meta: '~16 min · retrieve causes before drafting the argument',
    reasonShort: 'stale · essay soon',
  },
  {
    courseShort: 'PSYC 305',
    courseLong: 'PSYC 305 · Cognitive Psychology',
    topic: 'Working-memory interference',
    status: 'Weak · 36%',
    rankReason: 'Ranked #1 of 7 — two similar models are getting mixed up before Tuesday’s quiz.',
    meta: '~15 min · contrast the models with one retrieval check',
    reasonShort: 'mixed up · quiz Tue',
  },
  {
    courseShort: 'CIVL 331',
    courseLong: 'CIVL 331 · Structural Analysis',
    topic: 'Influence lines',
    status: 'Weak · 29%',
    rankReason: 'Ranked #1 of 9 — a prerequisite gap is blocking the current problem set.',
    meta: '~25 min · rebuild the moving-load setup first',
    reasonShort: 'blocked · due Wed',
  },
];

export function initTopicCycle(root: ParentNode = document) {
  const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-topic-cycle]'));
  if (!cards.length) return;

  let tick = 0;
  const render = () => {
    for (const card of cards) {
      const offset = Number(card.dataset.topicOffset ?? 0);
      const example = examples[(tick + offset) % examples.length];
      for (const [index, field] of Array.from(card.querySelectorAll<HTMLElement>('[data-topic-field]')).entries()) {
        const key = field.dataset.topicField as keyof TopicExample;
        field.style.setProperty('--topic-field-index', String(index));
        if (key in example) field.textContent = example[key];
      }
    }
  };

  render();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  window.setInterval(() => {
    tick += 1;
    for (const card of cards) card.classList.add('is-topic-leaving');
    window.setTimeout(() => {
      render();
      for (const card of cards) {
        card.classList.remove('is-topic-leaving');
        card.classList.add('is-topic-entering');
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          for (const card of cards) card.classList.remove('is-topic-entering');
        });
      });
    }, 220);
  }, 5200);
}
