/* ============================================================
   Compass — shared data model + helpers
   All screens read from window.COMPASS. Dates are ISO strings.
   ============================================================ */

window.COMPASS = {
  student: 'Maya',
  todayISO: '2026-08-11',
  term: 'Fall term · Week 2',

  courses: {
    cs:   { key: 'cs',   code: 'CS 2110',   name: 'Data Structures & Algorithms', color: 'var(--c-cs)',
            instructor: 'Dr. Okafor', slot: 'Mon · Wed · Fri 10:00', credits: 4, mastery: 52 },
    math: { key: 'math', code: 'MATH 2400', name: 'Linear Algebra II', color: 'var(--c-math)',
            instructor: 'Prof. Lindqvist', slot: 'Tue · Thu 09:00', credits: 3, mastery: 68 },
    psyc: { key: 'psyc', code: 'PSYC 1010', name: 'Introduction to Psychology', color: 'var(--c-psyc)',
            instructor: 'Dr. Marsh', slot: 'Mon · Wed 14:00', credits: 3, mastery: 81 },
    econ: { key: 'econ', code: 'ECON 2200', name: 'Microeconomic Theory', color: 'var(--c-econ)',
            instructor: 'Prof. Adeyemi', slot: 'Tue · Thu 13:00', credits: 3, mastery: 44 }
  },

  /* type: quiz | exam | assignment | lecture | lab | recitation */
  events: [
    { date: '2026-08-11', time: '13:00', course: 'econ', type: 'lecture',    title: 'Lecture 4 — Consumer choice' },
    { date: '2026-08-12', time: '23:59', course: 'cs',   type: 'assignment', title: 'Lab 2 report due' },
    { date: '2026-08-12', time: '14:00', course: 'psyc', type: 'quiz',       title: 'Reading quiz — Ch. 3' },
    { date: '2026-08-13', time: '23:59', course: 'math', type: 'assignment', title: 'Problem set 2 due' },
    { date: '2026-08-13', time: '16:00', course: 'cs',   type: 'recitation', title: 'Recitation — stacks walkthrough' },
    { date: '2026-08-14', time: '10:00', course: 'cs',   type: 'quiz',       title: 'Quiz 2 — Lists, stacks & queues' },
    { date: '2026-08-17', time: '13:00', course: 'econ', type: 'recitation', title: 'Tutorial 2 — elasticity problems' },
    { date: '2026-08-18', time: '10:00', course: 'cs',   type: 'lab',        title: 'Lab 3 — BST implementation' },
    { date: '2026-08-18', time: '23:59', course: 'psyc', type: 'assignment', title: 'Essay outline due' },
    { date: '2026-08-19', time: '10:00', course: 'cs',   type: 'lecture',    title: 'Lecture 9 — Hash tables' },
    { date: '2026-08-20', time: '09:00', course: 'math', type: 'exam',       title: 'Midterm 1 — Ch. 1–4' },
    { date: '2026-08-21', time: '23:59', course: 'cs',   type: 'assignment', title: 'Problem set 3 due' },
    { date: '2026-08-25', time: '13:00', course: 'econ', type: 'quiz',       title: 'Quiz 1 — supply & demand' },
    { date: '2026-08-27', time: '23:59', course: 'math', type: 'assignment', title: 'Problem set 3 due' },
    { date: '2026-09-02', time: '14:00', course: 'psyc', type: 'exam',       title: 'Midterm — Ch. 1–6' },
    { date: '2026-09-22', time: '10:00', course: 'cs',   type: 'exam',       title: 'Midterm — through hash tables' }
  ],

  /* Knowledge components for CS 2110 (course.html) */
  kcs: [
    { id: 'asym',  name: 'Asymptotic analysis',  mastery: 92, last: 'Quiz 1 · Aug 4',
      resources: 'Lecture 2 slides · Practice set 1.3 · Textbook §2.1–2.4' },
    { id: 'lists', name: 'Linked lists',          mastery: 88, last: 'Lab 1 · Aug 5',
      resources: 'Lecture 4 slides · Practice set 2.1 · Visualizer: list ops' },
    { id: 'stacks', name: 'Stacks & queues',      mastery: 74, last: 'Recitation · Aug 6',
      resources: 'Lecture 6 slides · Practice set 2.4 · Recitation notes wk 2' },
    { id: 'recur', name: 'Recursion',             mastery: 61, last: 'Worksheet 3 · Aug 7',
      resources: 'Lecture 5 slides · Worksheet 3 · Textbook §5.1–5.3' },
    { id: 'bst',   name: 'Binary search trees',   mastery: 38, last: 'Practice quiz · Aug 9',
      resources: 'Lecture 8 slides · Practice set 4.2 · Visualizer: BST insert/delete' },
    { id: 'hash',  name: 'Hash tables',           mastery: 0,  last: 'Not started — lecture Aug 19',
      resources: 'Pre-reading §12.1 · Lecture 9 (upcoming)' },
    { id: 'graph', name: 'Graph traversal',       mastery: 0,  last: 'Not started — unit opens Sep',
      resources: 'Unit opens after midterm' }
  ],

  notes: [
    { kind: 'course', course: 'cs',   text: 'Rehash when load factor > 0.75 — mentioned twice, likely on quiz' },
    { kind: 'course', course: 'math', text: 'Eigenvalue shortcut from lecture 6 — redo example 4' },
    { kind: 'course', course: 'psyc', text: 'Essay: pick encoding-failure study, cite Ch. 3' },
    { kind: 'personal', text: 'Gym Tue / Thu 7:00' },
    { kind: 'personal', text: 'Scholarship essay draft — end of month' }
  ],

  todosSeed: [
    { id: 't1', text: 'Email Dr. Okafor about lab partner switch', done: false },
    { id: 't2', text: 'Book group room for MATH midterm study session', done: false },
    { id: 't3', text: 'Print PSYC consent form for Wednesday', done: true }
  ]
};

/* ---------- helpers ---------- */

COMPASS.fmt = function (iso, opts) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', opts || { weekday: 'short', month: 'short', day: 'numeric' });
};

COMPASS.upcoming = function (filterCourse, limit) {
  return COMPASS.events
    .filter(e => e.date >= COMPASS.todayISO)
    .filter(e => !filterCourse || e.course === filterCourse)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
    .slice(0, limit || 999);
};

COMPASS.daysUntil = function (iso) {
  return Math.round((new Date(iso) - new Date(COMPASS.todayISO)) / 86400000);
};

/* Suggested-next ranking — the pedagogy knob.
   Score = mastery gap, boosted when a graded event touching that
   component lands inside the next 5 days. Tune weights here. */
COMPASS.rankSuggestions = function () {
  const soonQuiz = COMPASS.upcoming('cs').find(e => (e.type === 'quiz' || e.type === 'exam'));
  const soonBoost = soonQuiz && COMPASS.daysUntil(soonQuiz.date) <= 5;
  const tasks = [
    { kc: 'stacks', kcName: 'Stacks & queues', mins: 25, title: 'Re-run stack & queue operations drill',
      why: soonBoost ? 'Quiz 2 covers this Friday — currently at 74%' : 'Currently at 74%',
      score: (100 - 74) + (soonBoost ? 40 : 0) },
    { kc: 'bst', kcName: 'Binary search trees', mins: 40, title: 'BST insertion & deletion — practice set 4.2',
      why: 'Your weakest assessed component (38%) — Lab 3 builds on it Tuesday',
      score: (100 - 38) },
    { kc: 'recur', kcName: 'Recursion', mins: 30, title: 'Worksheet 3, questions 5–8',
      why: 'At 61% — BSTs and graph units both lean on recursion',
      score: (100 - 61) }
  ];
  return tasks.sort((a, b) => b.score - a.score);
};

COMPASS.TYPE_LABEL = {
  quiz: 'Quiz', exam: 'Exam', assignment: 'Due', lecture: 'Lecture', lab: 'Lab', recitation: 'Recitation'
};
