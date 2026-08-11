let courses = [];
let activeCourse = 0;
let activeConcept = null;
let recommendedConcept = null;
let skipped = JSON.parse(localStorage.getItem('sem3-skipped') || '[]');
let progress = JSON.parse(localStorage.getItem('sem3-progress') || '{}');
let events = JSON.parse(localStorage.getItem('sem3-events') || '[]');
let sessions = JSON.parse(localStorage.getItem('sem3-sessions') || '[]');
let timerId = null;
let timerStartedAt = null;
let timerDuration = 25 * 60;

const $ = (id) => document.getElementById(id);
const keyFor = (course, branch, concept) => `${course.code}::${branch.branch}::${concept.name}`;

async function init() {
  courses = window.SEM3_COURSES || await fetch('courses.json').then(r => r.json());
  renderNav();
  renderCourse();
  bindEvents();
}

function bindEvents() {
  $('newEventBtn').addEventListener('click', () => $('eventDialog').showModal());
  $('saveEventBtn').addEventListener('click', saveEvent);
  $('confidenceInput').addEventListener('input', updateActiveConcept);
  $('practiceInput').addEventListener('input', updateActiveConcept);
  $('statusInput').addEventListener('change', updateActiveConcept);
  $('exportBtn').addEventListener('click', exportProgress);
  $('startSessionBtn').addEventListener('click', () => startFocusSession(recommendedConcept));
  $('focusFromSidebarBtn').addEventListener('click', () => startFocusSession(recommendedConcept));
  $('skipConceptBtn').addEventListener('click', skipRecommendedConcept);
  $('markDoneBtn').addEventListener('click', () => completeFocusSession('done'));
  $('markStuckBtn').addEventListener('click', () => completeFocusSession('stuck'));
  $('closeFocusBtn').addEventListener('click', closeFocusMode);
}

function saveEvent(e) {
  if (!$('eventForm').checkValidity()) return;
  e.preventDefault();
  events.push({
    course: courses[activeCourse].code,
    title: $('eventTitle').value,
    date: $('eventDate').value,
    type: $('eventType').value
  });
  localStorage.setItem('sem3-events', JSON.stringify(events));
  $('eventForm').reset();
  $('eventDialog').close();
  renderCalendar();
}

function renderNav() {
  $('courseNav').innerHTML = courses.map((c, i) => `
    <button class="nav-btn ${i === activeCourse ? 'active' : ''}" data-course="${i}">
      ${c.code}<small>${c.title}</small>
    </button>
  `).join('');
  document.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => {
    activeCourse = Number(btn.dataset.course);
    activeConcept = null;
    closeFocusMode();
    renderNav();
    renderCourse();
  }));
}

function renderCourse() {
  const c = courses[activeCourse];
  $('courseTitle').textContent = `${c.code} — ${c.title}`;
  $('courseMeta').textContent = `${c.term} · ${c.credits} credits · Instructor: ${c.instructor} · ${c.prereqs}`;
  renderCalendar();
  renderTimeline();
  renderOverall();
  selectFirstConcept();
  renderNextMove();
}

function renderCalendar() {
  const c = courses[activeCourse];
  const courseEvents = events.filter(e => e.course === c.code);
  $('calendarNotice').innerHTML = courseEvents.length
    ? `You have ${courseEvents.length} saved date(s) for ${c.code}. Add official schedule/exam dates when McGill posts or your syllabus arrives.`
    : `<strong>Missing official detailed schedule.</strong> Add class schedule, labs, midterms, finals, assignments, and review blocks when available.`;

  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  const cells = [];
  for (let i = 0; i < 35; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = d.toISOString().slice(0,10);
    const ev = courseEvents.filter(e => e.date === iso);
    cells.push(`<div class="day"><strong>${d.toLocaleDateString(undefined, {month:'short', day:'numeric'})}</strong>${ev.map(e => `<div class="event">${e.type}: ${e.title}</div>`).join('')}</div>`);
  }
  $('calendarGrid').innerHTML = cells.join('');
}

function renderTimeline() {
  const c = courses[activeCourse];
  $('timeline').innerHTML = c.branches.map((branch, bi) => `
    <div class="branch" style="animation-delay:${bi * 45}ms">
      <h4>${bi + 1}. ${branch.branch}</h4>
      <div class="concepts">
        ${branch.concepts.map((concept, ci) => {
          const k = keyFor(c, branch, concept);
          const saved = progress[k] || concept;
          const dot = saved.confidence >= 75 ? 'high' : saved.confidence >= 35 ? 'mid' : '';
          return `<button class="concept-pill" data-bi="${bi}" data-ci="${ci}"><span class="conf-dot ${dot}"></span>${concept.name} · ${saved.confidence || 0}%</button>`;
        }).join('')}
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.concept-pill').forEach(btn => btn.addEventListener('click', () => selectConcept(Number(btn.dataset.bi), Number(btn.dataset.ci))));
}

function selectFirstConcept() {
  const c = courses[activeCourse];
  if (c.branches[0]?.concepts[0]) selectConcept(0,0);
}

function selectConcept(bi, ci) {
  const c = courses[activeCourse];
  const branch = c.branches[bi];
  const concept = branch.concepts[ci];
  activeConcept = { bi, ci };
  document.querySelectorAll('.concept-pill').forEach(el => el.classList.remove('active'));
  const active = document.querySelector(`.concept-pill[data-bi="${bi}"][data-ci="${ci}"]`);
  if (active) active.classList.add('active');

  const saved = progress[keyFor(c, branch, concept)] || concept;
  $('conceptName').textContent = concept.name;
  $('conceptContext').textContent = `${c.code} · ${branch.branch}`;
  $('confidenceInput').value = saved.confidence || 0;
  $('confidenceLabel').textContent = saved.confidence || 0;
  $('practiceInput').value = saved.practice || defaultPractice(c, branch, concept);
  $('statusInput').value = saved.status || 'not-started';
  $('materialsList').innerHTML = c.canonical.map(x => `<li><a href="${x.url}" target="_blank" rel="noopener">${x.label}</a></li>`).join('');
  $('feedList').innerHTML = c.feed.map(x => `<li><a href="${x.url}" target="_blank" rel="noopener">${x.label}</a></li>`).join('');
}

function allConcepts(course) {
  const items = [];
  course.branches.forEach((branch, bi) => branch.concepts.forEach((concept, ci) => {
    const k = keyFor(course, branch, concept);
    items.push({ course, branch, concept, bi, ci, key: k, saved: progress[k] || concept });
  }));
  return items;
}

function pickNextConcept() {
  const c = courses[activeCourse];
  const skippedSet = new Set(skipped);
  const candidates = allConcepts(c)
    .filter(item => !skippedSet.has(item.key))
    .sort((a, b) => scoreConcept(a) - scoreConcept(b));
  return candidates[0] || allConcepts(c).sort((a, b) => scoreConcept(a) - scoreConcept(b))[0];
}

function scoreConcept(item) {
  const confidence = item.saved.confidence || 0;
  const statusPenalty = item.saved.status === 'needs-help' ? -25 : item.saved.status === 'not-started' ? -10 : item.saved.status === 'learning' ? -5 : 0;
  return confidence + statusPenalty;
}

function renderNextMove() {
  recommendedConcept = pickNextConcept();
  if (!recommendedConcept) return;
  const { course, branch, concept, saved } = recommendedConcept;
  $('nextConceptName').textContent = `${concept.name}`;
  $('nextMoveHeading').textContent = `${course.code}: ${concept.name}`;
  const confidence = saved.confidence || 0;
  const reason = saved.status === 'needs-help'
    ? 'Marked as needing help — make it visible and shrink it into one proof task.'
    : confidence === 0
      ? 'Untouched concept — easiest win is to get from 0% to a rough first pass.'
      : `Lowest current confidence in this course at ${confidence}%.`;
  $('nextMoveWhy').textContent = `${reason} Branch: ${branch.branch}.`;
  $('nextConceptAction').textContent = defaultPractice(course, branch, concept).split('\n').slice(1).join(' ');
}

function defaultPractice(c, branch, concept) {
  return `Practice prompt for ${concept.name}:\n1. Write the core definition from memory.\n2. Solve or design one representative problem/application.\n3. Explain how it connects to ${branch.branch} in ${c.code}.\n4. Mark what still feels fuzzy.`;
}

function updateActiveConcept() {
  if (!activeConcept) return;
  const c = courses[activeCourse];
  const branch = c.branches[activeConcept.bi];
  const concept = branch.concepts[activeConcept.ci];
  const k = keyFor(c, branch, concept);
  progress[k] = {
    ...concept,
    confidence: Number($('confidenceInput').value),
    practice: $('practiceInput').value,
    status: $('statusInput').value
  };
  $('confidenceLabel').textContent = progress[k].confidence;
  localStorage.setItem('sem3-progress', JSON.stringify(progress));
  renderTimeline();
  renderOverall();
  renderNextMove();
  selectConcept(activeConcept.bi, activeConcept.ci);
}

function renderOverall() {
  const c = courses[activeCourse];
  const vals = [];
  c.branches.forEach(b => b.concepts.forEach(concept => vals.push((progress[keyFor(c,b,concept)] || concept).confidence || 0)));
  const avg = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
  $('overallScore').textContent = `${avg}%`;
}

function skipRecommendedConcept() {
  if (!recommendedConcept) return;
  skipped.push(recommendedConcept.key);
  localStorage.setItem('sem3-skipped', JSON.stringify(skipped));
  renderNextMove();
}

function startFocusSession(item) {
  if (!item) return;
  const { course, branch, concept, bi, ci } = item;
  selectConcept(bi, ci);
  $('focusMode').hidden = false;
  $('focusTitle').textContent = `${course.code}: ${concept.name}`;
  $('proofTask').textContent = `Proof task: write the core definition from memory, solve or outline one representative ${concept.name} problem, then write what remains fuzzy.`;
  $('focusMode').scrollIntoView({ behavior: 'smooth', block: 'center' });
  timerStartedAt = Date.now();
  clearInterval(timerId);
  timerId = setInterval(renderTimer, 500);
  renderTimer();
}

function renderTimer() {
  if (!timerStartedAt) return;
  const elapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
  const remaining = Math.max(0, timerDuration - elapsed);
  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const seconds = String(remaining % 60).padStart(2, '0');
  $('timerDisplay').textContent = `${minutes}:${seconds}`;
  $('timerRail').style.width = `${Math.min(100, (elapsed / timerDuration) * 100)}%`;
  if (remaining === 0) clearInterval(timerId);
}

function completeFocusSession(outcome) {
  if (!activeConcept) return;
  const c = courses[activeCourse];
  const branch = c.branches[activeConcept.bi];
  const concept = branch.concepts[activeConcept.ci];
  const k = keyFor(c, branch, concept);
  const current = progress[k] || concept;
  progress[k] = {
    ...current,
    confidence: outcome === 'done' ? Math.max(current.confidence || 0, 35) : current.confidence || 0,
    practice: $('practiceInput').value || defaultPractice(c, branch, concept),
    status: outcome === 'done' ? 'learning' : 'needs-help'
  };
  sessions.push({ course: c.code, concept: concept.name, outcome, at: new Date().toISOString() });
  localStorage.setItem('sem3-progress', JSON.stringify(progress));
  localStorage.setItem('sem3-sessions', JSON.stringify(sessions));
  closeFocusMode();
  renderCourse();
}

function closeFocusMode() {
  $('focusMode').hidden = true;
  clearInterval(timerId);
  timerId = null;
  timerStartedAt = null;
  $('timerDisplay').textContent = '25:00';
  $('timerRail').style.width = '0%';
}

function exportProgress() {
  const blob = new Blob([JSON.stringify({ courses, progress, events, sessions }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sem3-study-progress.json';
  a.click();
  URL.revokeObjectURL(url);
}

init().catch(err => {
  document.body.innerHTML = `<pre style="color:white;padding:2rem">Failed to load app: ${err.stack}</pre>`;
});
