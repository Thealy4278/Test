/* Math Quest – screens, quiz flow, grading, profiles, and progress. */
(function () {
  'use strict';

  const { GRADES, TOPICS, generateQuiz, checkAnswer } = window.MathQuestions;
  const P = window.MathProfiles;
  const C = window.Celebrate;
  const COUNTS = [5, 10, 15, 20];
  const SCREENS = ['profiles', 'login-screen', 'profile-form-screen', 'dashboard', 'setup', 'quiz', 'results'];
  const GUEST_KEY = 'mathquest-settings';
  const $ = (id) => document.getElementById(id);

  const state = {
    grade: null,
    topic: null,
    count: 10,
    questions: [],
    answers: [],
    index: 0,
    screen: null,
    editing: false,
    formAvatar: null,
    loginPlayer: null,
  };

  const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const topicName = (id) => (id === 'mixed' ? 'Mixed Review' : (TOPICS[id] && TOPICS[id].label) || id);
  const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtDay = (t) => new Date(t).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function show(screen) {
    state.screen = screen;
    for (const id of SCREENS) $(id).hidden = id !== screen;
    renderHeader();
    window.scrollTo(0, 0);
  }

  const okToLeaveQuiz = () => state.screen !== 'quiz' || confirm('Leave this quiz? Your answers will be lost.');

  function renderHeader() {
    const p = P.active();
    $('player-chip').hidden = !p;
    if (p) {
      $('player-avatar').textContent = p.avatar;
      $('player-name').textContent = p.name;
    }
    const signedIn = !!p;
    $('switch-btn').hidden = !signedIn && (state.screen === 'profiles' || state.screen === 'login-screen' || state.screen === 'profile-form-screen');
    $('switch-btn').textContent = signedIn ? 'Log out' : 'Players';
  }

  function showError(id, message) {
    $(id).textContent = message || '';
    $(id).hidden = !message;
  }

  // ---------- players & login ----------
  function openProfiles() {
    const grid = $('profile-grid');
    grid.replaceChildren();
    const online = P.online();
    grid.hidden = !online;
    $('offline-note').hidden = online;
    if (online) {
      for (const p of P.players()) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'profile-card';
        b.innerHTML = `<span class="avatar lg" aria-hidden="true">${p.avatar}</span><span class="pc-name"></span><span class="pc-sub"></span>`;
        b.querySelector('.pc-name').textContent = p.name;
        b.querySelector('.pc-sub').textContent = `Grade ${p.grade} · ${plural(p.quizzes, 'quiz', 'quizzes')}`;
        b.addEventListener('click', () => openLogin(p));
        grid.appendChild(b);
      }
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'profile-card add';
      add.innerHTML = '<span class="avatar lg plus" aria-hidden="true">+</span><span class="pc-name">New player</span><span class="pc-sub">Save scores &amp; set goals</span>';
      add.addEventListener('click', () => openProfileForm(false));
      grid.appendChild(add);
    }
    $('storage-note').textContent = online
      ? 'Progress is saved in the Math Quest database. Each player logs in with their own password.'
      : '';
    show('profiles');
  }

  // A player without a password yet (made before logins, or reset by a parent) picks one here.
  function openLogin(player) {
    state.loginPlayer = player;
    const setting = !player.hasPassword;
    $('login-avatar').textContent = player.avatar;
    $('login-title').textContent = setting ? `Hi, ${player.name}!` : `Welcome back, ${player.name}!`;
    $('login-sub').textContent = setting
      ? 'Choose a password so only you can open your progress. A PIN like 2468 works too.'
      : 'Type your password to log in.';
    $('login-pw-label').textContent = setting ? 'New password' : 'Password';
    $('login-password').value = '';
    $('login-password').autocomplete = setting ? 'new-password' : 'current-password';
    $('login-confirm').value = '';
    $('login-confirm-field').hidden = !setting;
    $('login-submit').textContent = setting ? 'Save & log in' : 'Log in';
    showError('login-error', '');
    show('login-screen');
    $('login-password').focus();
  }

  async function submitLogin() {
    const player = state.loginPlayer;
    const pw = $('login-password').value;
    if (!player.hasPassword && pw !== $('login-confirm').value) {
      showError('login-error', "The two passwords don't match. Try again.");
      return;
    }
    $('login-submit').disabled = true;
    try {
      await P.login(player.id, pw);
      openSetup();
    } catch (e) {
      showError('login-error', e.message);
      $('login-password').select();
    } finally {
      $('login-submit').disabled = false;
    }
  }

  function logout() {
    P.logout();
    openProfiles();
    P.refreshPlayers().then(() => { if (state.screen === 'profiles') openProfiles(); });
  }

  function openProfileForm(editing) {
    const p = editing ? P.active() : null;
    state.editing = !!p;
    state.formAvatar = p ? p.avatar : P.AVATARS[Math.floor(Math.random() * P.AVATARS.length)];
    $('profile-form-title').textContent = p ? 'Edit player' : 'New player';
    $('pf-name').value = p ? p.name : '';
    $('pf-grade').value = String(p ? p.grade : state.grade || 1);
    $('pf-password').value = '';
    $('pf-confirm').value = '';
    $('pf-password').required = !p;
    $('pf-password-label').textContent = p ? 'New password (leave blank to keep your current one)' : 'Password';
    $('pf-danger').hidden = !p;
    showError('pf-error', '');
    renderAvatarPicker();
    show('profile-form-screen');
    $('pf-name').focus();
  }

  async function submitProfileForm() {
    const name = $('pf-name').value.trim();
    const pw = $('pf-password').value;
    if (!name) { $('pf-name').focus(); return; }
    if ((pw || !state.editing) && pw.length < 4) { showError('pf-error', 'Passwords need at least 4 characters.'); return; }
    if (pw !== $('pf-confirm').value) { showError('pf-error', "The two passwords don't match. Try again."); return; }
    const fields = { name, avatar: state.formAvatar, grade: +$('pf-grade').value };
    if (pw) fields.password = pw;
    try {
      if (state.editing) { await P.edit(fields); openDashboard(); }
      else { await P.create(fields); openSetup({ grade: fields.grade }); }
    } catch (e) {
      showError('pf-error', e.status === 401 ? 'Your login ended. Please log in again.' : e.message);
    }
  }

  function renderAvatarPicker() {
    const wrap = $('pf-avatars');
    wrap.replaceChildren();
    for (const a of P.AVATARS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'avatar-opt' + (a === state.formAvatar ? ' selected' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(a === state.formAvatar));
      b.textContent = a;
      b.addEventListener('click', () => { state.formAvatar = a; renderAvatarPicker(); });
      wrap.appendChild(b);
    }
  }

  // ---------- setup ----------
  function openSetup(preset) {
    const p = P.active();
    let saved = null;
    if (p) saved = p.last || { grade: p.grade };
    else { try { saved = JSON.parse(localStorage.getItem(GUEST_KEY) || 'null'); } catch (e) { /* storage unavailable */ } }
    const s = { ...(saved || {}), ...(preset || {}) };

    state.grade = GRADES[s.grade] ? s.grade : null;
    state.topic = state.grade && (s.topic === 'mixed' || (GRADES[state.grade] || []).includes(s.topic)) ? s.topic : null;
    if (COUNTS.includes(s.count)) state.count = s.count;

    $('setup-title').textContent = p ? `Hi, ${p.name}! Let's practice math!` : "Let's practice math!";
    renderSetup();
    show('setup');
  }

  function chip(label, selected, onClick, extraClass = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip ${extraClass}${selected ? ' selected' : ''}`;
    b.setAttribute('aria-pressed', String(selected));
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderSetup() {
    const grid = $('grade-grid');
    grid.replaceChildren();
    for (let g = 1; g <= 12; g++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `grade-btn g${g}${state.grade === g ? ' selected' : ''}`;
      b.setAttribute('aria-pressed', String(state.grade === g));
      b.innerHTML = `<small>Grade</small><span>${g}</span>`;
      b.addEventListener('click', () => {
        if (state.grade !== g) state.topic = null;
        state.grade = g;
        renderSetup();
      });
      grid.appendChild(b);
    }

    const topics = $('topic-list');
    topics.replaceChildren();
    if (!state.grade) {
      topics.innerHTML = '<p class="muted">Pick a grade first.</p>';
    } else {
      topics.appendChild(chip('Mixed Review', state.topic === 'mixed', () => { state.topic = 'mixed'; renderSetup(); }, 'mixed'));
      for (const id of GRADES[state.grade]) {
        topics.appendChild(chip(TOPICS[id].label, state.topic === id, () => { state.topic = id; renderSetup(); }));
      }
    }

    const counts = $('count-list');
    counts.replaceChildren();
    for (const c of COUNTS) {
      counts.appendChild(chip(String(c), state.count === c, () => { state.count = c; renderSetup(); }, 'count'));
    }

    $('start-btn').disabled = !(state.grade && state.topic);
  }

  function saveSettings() {
    const settings = { grade: state.grade, topic: state.topic, count: state.count };
    const p = P.active();
    if (p) { P.saveLast(settings); return; }
    try { localStorage.setItem(GUEST_KEY, JSON.stringify(settings)); } catch (e) { /* storage unavailable */ }
  }

  // ---------- quiz ----------
  function startQuiz(keepQuestions = false) {
    if (!keepQuestions) state.questions = generateQuiz(state.grade, state.topic, state.count);
    state.answers = state.questions.map(() => '');
    state.index = 0;
    saveSettings();
    $('quiz-meta').textContent = `Grade ${state.grade} · ${topicName(state.topic)}`;
    $('unanswered').hidden = true;
    show('quiz');
    renderQuestion();
  }

  const answeredCount = () => state.answers.filter((a) => a.trim()).length;

  function renderProgress() {
    $('progress-bar').style.width = `${(answeredCount() / state.questions.length) * 100}%`;
    const dots = $('dots');
    dots.replaceChildren();
    state.questions.forEach((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dot' + (state.answers[i].trim() ? ' answered' : '') + (i === state.index ? ' current' : '');
      b.textContent = i + 1;
      b.setAttribute('aria-label', `Question ${i + 1}${state.answers[i].trim() ? ', answered' : ''}`);
      b.addEventListener('click', () => goTo(i));
      dots.appendChild(b);
    });
  }

  function renderQuestion() {
    const q = state.questions[state.index];
    const last = state.index === state.questions.length - 1;
    $('q-number').textContent = `Question ${state.index + 1} of ${state.questions.length}`;
    $('q-topic').textContent = state.topic === 'mixed' ? q.topic : '';
    $('q-text').innerHTML = q.text;
    $('q-hint').textContent = q.hint || 'Type your answer, then press Enter.';
    const input = $('answer-input');
    input.value = state.answers[state.index];
    $('prev-btn').disabled = state.index === 0;
    $('next-btn').textContent = last ? 'Finish & Grade ✓' : 'Next →';
    $('next-btn').classList.toggle('finish', last);
    renderProgress();
    input.focus();
  }

  function goTo(i) {
    state.index = i;
    $('unanswered').hidden = true;
    renderQuestion();
  }

  function next() {
    if (state.index < state.questions.length - 1) goTo(state.index + 1);
    else finish();
  }

  function finish() {
    const missing = state.questions.length - answeredCount();
    if (missing > 0) {
      $('unanswered-text').textContent = missing === 1
        ? 'You have 1 question without an answer.'
        : `You have ${missing} questions without an answer.`;
      $('unanswered').hidden = false;
      $('unanswered').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    grade();
  }

  // ---------- results ----------
  function messageFor(pct) {
    if (pct === 100) return 'Perfect score!';
    if (pct >= 90) return 'Amazing work!';
    if (pct >= 80) return 'Great job!';
    if (pct >= 60) return 'Good effort!';
    return 'Keep practicing!';
  }

  function grade() {
    const results = state.questions.map((q, i) => ({ q, given: state.answers[i].trim(), correct: checkAnswer(q, state.answers[i]) }));
    const right = results.filter((r) => r.correct).length;
    const total = results.length;
    const pct = Math.round((right / total) * 100);
    const letter = P.letterFor(pct);

    $('score-pct').textContent = `${pct}%`;
    $('score-letter').textContent = letter;
    $('score-ring').style.setProperty('--pct', pct);
    $('score-ring').dataset.level = pct >= 80 ? 'high' : pct >= 60 ? 'mid' : 'low';
    $('score-message').textContent = messageFor(pct);
    $('score-detail').textContent = `You got ${right} out of ${total} questions right.`;
    $('score-card').classList.remove('celebrate-a', 'celebrate-b');

    // Save to the player's history and check goals.
    const p = P.active();
    let completedGoals = [];
    if (p) {
      completedGoals = P.recordQuiz(p, {
        at: Date.now(), grade: state.grade, topic: state.topic, topicLabel: topicName(state.topic), total, right, pct,
      });
      $('saved-note').textContent = `Saved to ${p.name}'s progress.`;
    } else {
      $('saved-note').textContent = 'Playing as a guest. Create a player to save your scores.';
    }
    renderGoalUpdates(p, completedGoals);
    renderReview(results);
    show('results');
    celebrate(pct, letter, completedGoals);
  }

  function renderReview(results) {
    const list = $('review-list');
    list.replaceChildren();
    for (const r of results) {
      const li = document.createElement('li');
      li.className = `review-item ${r.correct ? 'right' : 'wrong'}`;
      const yours = r.given ? escapeHTML(r.given) : '<em>No answer</em>';
      li.innerHTML = `
        <span class="mark" aria-hidden="true">${r.correct ? '✓' : '✗'}</span>
        <div class="review-body">
          <div class="review-q">${r.q.text}</div>
          <div class="review-a">
            <span>Your answer: <b>${yours}</b></span>
            ${r.correct ? '<span class="tag right">Correct</span>' : `<span>Correct answer: <b>${escapeHTML(r.q.display)}</b></span>`}
          </div>
        </div>`;
      list.appendChild(li);
    }
  }

  function renderGoalUpdates(p, completedGoals) {
    const box = $('goal-updates');
    const goals = p ? p.goals.filter((g) => !g.completedAt || completedGoals.includes(g)) : [];
    box.hidden = !goals.length;
    const list = $('goal-update-list');
    list.replaceChildren(...goals.map((g) => goalItem(p, g, { justDone: completedGoals.includes(g) })));
  }

  function celebrate(pct, letter, completedGoals) {
    const card = $('score-card');
    void card.offsetWidth; // restart the CSS animation
    if (letter === 'A') {
      card.classList.add('celebrate-a');
      C.fireworks(pct === 100 ? 6500 : 4500);
      C.confetti(pct === 100 ? 220 : 160);
      C.banner(pct === 100 ? 'PERFECT! 100%' : 'You earned an A!', pct === 100 ? 'Every single answer right. Superstar!' : 'Math superstar!', 'tone-a', 3600);
    } else if (letter === 'B') {
      card.classList.add('celebrate-b');
      C.confetti(130);
      C.banner('You earned a B!', 'Awesome work. Keep it up!', 'tone-b', 2800);
    }
    for (const g of completedGoals) {
      C.banner('Goal complete! 🏆', P.describeGoal(g), 'tone-goal', 2800);
      setTimeout(() => C.confetti(90), letter === 'A' ? 4000 : letter === 'B' ? 3200 : 300);
    }
  }

  // ---------- dashboard ----------
  function openDashboard() {
    const p = P.active();
    if (!p) { openProfiles(); return; }
    const s = P.stats(p);

    $('dash-avatar').textContent = p.avatar;
    $('dash-name').textContent = p.name;
    $('dash-sub').textContent = `Grade ${p.grade} · Playing since ${fmtDate(p.createdAt)}`;

    const tiles = [
      ['Quizzes finished', s.total],
      ['Average score', s.total ? `${s.avg}%` : '—'],
      ['Best score', s.total ? `${s.best}%` : '—'],
      ["A's earned", s.aCount],
      ['Day streak', s.streak ? `${s.streak} 🔥` : '0'],
    ];
    $('stat-tiles').innerHTML = tiles.map(([label, value]) =>
      `<div class="stat-tile"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join('');

    renderChart($('score-chart'), p.history);
    renderGoals(p);
    renderTopicTable(p, s.topics);
    renderHistory(p);
    $('goal-form').hidden = true;
    show('dashboard');
  }

  function barPath(x, y, w, h) {
    const r = Math.min(4, h, w / 2);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function renderChart(el, history) {
    const data = history.slice(-15);
    if (!data.length) {
      el.innerHTML = '<p class="empty">Finish a quiz to see your scores here.</p>';
      return;
    }
    const W = 640, H = 220, m = { l: 44, r: 8, t: 22, b: 28 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const slot = pw / Math.max(data.length, 8);
    const bw = Math.min(24, slot - 4);
    const y = (v) => m.t + ph - (v / 100) * ph;
    const base = m.t + ph;

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart of your last ${data.length} quiz scores">`;
    for (const v of [0, 50, 100]) {
      svg += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis" x="${m.l - 8}" y="${y(v)}" text-anchor="end" dominant-baseline="middle">${v}%</text>`;
    }
    svg += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${y(90)}" y2="${y(90)}"/>`;
    svg += `<text class="ref-label" x="${m.l - 8}" y="${y(90)}" text-anchor="end" dominant-baseline="middle">A</text>`;

    let prevDay = '';
    data.forEach((h, i) => {
      const sx = m.l + i * slot;
      const x = sx + (slot - bw) / 2;
      const top = y(h.pct);
      const label = `${fmtDate(h.at)}, Grade ${h.grade} ${h.topicLabel}: ${h.pct}%`;
      svg += `<g class="bar-group" tabindex="0" data-i="${i}" aria-label="${escapeHTML(label)}">`;
      svg += `<rect class="hit" x="${sx}" y="${m.t}" width="${slot}" height="${ph + m.b}"/>`;
      svg += h.pct > 0
        ? `<path class="bar" d="${barPath(x, top, bw, base - top)}"/>`
        : `<rect class="bar zero" x="${x}" y="${base - 2}" width="${bw}" height="2"/>`;
      svg += '</g>';
      const day = fmtDay(h.at);
      if (day !== prevDay) svg += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${day}</text>`;
      prevDay = day;
      if (i === data.length - 1) svg += `<text class="value" x="${x + bw / 2}" y="${top - 7}" text-anchor="middle">${h.pct}%</text>`;
    });
    svg += '</svg>';
    el.innerHTML = `${svg}<div class="chart-tip" hidden></div>`;

    const tip = el.querySelector('.chart-tip');
    const showTip = (g) => {
      const h = data[+g.dataset.i];
      tip.replaceChildren();
      const v = document.createElement('div');
      v.className = 'tip-value';
      v.textContent = `${h.pct}% · ${P.letterFor(h.pct)}`;
      const d = document.createElement('div');
      d.textContent = `${h.right} of ${h.total} right`;
      const t = document.createElement('div');
      t.className = 'tip-sub';
      t.textContent = `Grade ${h.grade} · ${h.topicLabel} · ${fmtDate(h.at)}`;
      tip.append(v, d, t);
      tip.hidden = false;
      const bar = g.querySelector('.bar').getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const half = tip.offsetWidth / 2;
      const cx = Math.max(half, Math.min(box.width - half, bar.left - box.left + bar.width / 2));
      tip.style.left = `${cx}px`;
      tip.style.top = `${bar.top - box.top}px`;
    };
    el.querySelectorAll('.bar-group').forEach((g) => {
      g.addEventListener('pointerenter', () => showTip(g));
      g.addEventListener('focus', () => showTip(g));
      g.addEventListener('pointerleave', () => { tip.hidden = true; });
      g.addEventListener('blur', () => { tip.hidden = true; });
    });
  }

  function goalItem(p, g, opts = {}) {
    const prog = P.goalProgress(p, g);
    const li = document.createElement('li');
    li.className = 'goal-item' + (prog.done ? ' done' : '') + (opts.justDone ? ' just-done' : '');
    li.innerHTML = `
      <span class="goal-icon" aria-hidden="true">${prog.done ? '🏆' : '🎯'}</span>
      <div class="goal-body">
        <div class="goal-title"></div>
        <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(prog.fraction * 100)}"><span style="width:${prog.fraction * 100}%"></span></div>
        <div class="goal-meta"></div>
      </div>`;
    li.querySelector('.goal-title').textContent = P.describeGoal(g);
    li.querySelector('.goal-meta').textContent = opts.justDone
      ? 'You just did it!'
      : prog.done ? `Completed ${fmtDate(g.completedAt || Date.now())}` : prog.text;
    if (opts.removable) {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'goal-remove';
      x.setAttribute('aria-label', `Remove goal: ${P.describeGoal(g)}`);
      x.textContent = '×';
      x.addEventListener('click', () => { P.removeGoal(p, g.id); renderGoals(p); });
      li.appendChild(x);
    }
    return li;
  }

  function renderGoals(p) {
    const list = $('goal-list');
    const goals = [...p.goals].sort((a, b) => (!!a.completedAt - !!b.completedAt) || b.createdAt - a.createdAt);
    if (!goals.length) {
      list.innerHTML = '<li class="empty">No goals yet. Goals are optional. Add one if you want something to aim for!</li>';
      return;
    }
    list.replaceChildren(...goals.map((g) => goalItem(p, g, { removable: true })));
  }

  function openGoalForm() {
    const p = P.active();
    const type = $('goal-type');
    if (!type.options.length) {
      for (const [id, t] of Object.entries(P.GOAL_TYPES)) type.add(new Option(t.label, id));
    }
    type.value = 'quizzes';
    const topic = $('goal-topic');
    topic.replaceChildren(new Option('Any topic', 'any'), new Option(`Grade ${p.grade} Mixed Review`, 'mixed'),
      ...GRADES[p.grade].map((id) => new Option(`Grade ${p.grade} ${TOPICS[id].label}`, id)));
    syncGoalForm();
    $('goal-form').hidden = false;
    type.focus();
  }

  function syncGoalForm() {
    const t = P.GOAL_TYPES[$('goal-type').value];
    const [def, min, max] = t.target;
    const input = $('goal-target');
    input.min = min; input.max = max; input.value = def;
    $('goal-target-label').textContent = t.ask;
    $('goal-topic-field').hidden = $('goal-type').value !== 'score';
  }

  function renderTopicTable(p, topics) {
    const el = $('topic-table');
    if (!topics.length) { el.innerHTML = '<p class="empty">Topics you practice will show up here.</p>'; return; }
    el.innerHTML = `<table class="topic-table">
      <thead><tr><th>Topic</th><th class="num">Quizzes</th><th class="num">Average</th><th class="num">Best</th><th></th></tr></thead>
      <tbody></tbody></table>`;
    const body = el.querySelector('tbody');
    for (const t of topics) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><span class="t-grade">Grade ${t.grade}</span> <span class="t-name"></span></td>
        <td class="num">${t.count}</td><td class="num">${t.avg}%</td><td class="num">${t.best}%</td>
        <td class="num"><button type="button" class="btn small">Practice</button></td>`;
      tr.querySelector('.t-name').textContent = t.label;
      tr.querySelector('button').addEventListener('click', () => openSetup({ grade: t.grade, topic: t.topic }));
      body.appendChild(tr);
    }
  }

  function renderHistory(p) {
    const list = $('history-list');
    const recent = p.history.slice(-20).reverse();
    if (!recent.length) { list.innerHTML = '<li class="empty">No quizzes yet.</li>'; return; }
    list.replaceChildren(...recent.map((h) => {
      const li = document.createElement('li');
      const letter = P.letterFor(h.pct);
      li.innerHTML = `<span class="h-letter l-${letter}">${letter}</span>
        <span class="h-main"><span class="h-topic"></span><span class="h-date">${fmtDate(h.at)}</span></span>
        <span class="h-score">${h.right}/${h.total} · ${h.pct}%</span>`;
      li.querySelector('.h-topic').textContent = `Grade ${h.grade} · ${h.topicLabel}`;
      return li;
    }));
  }

  // ---------- events ----------
  // Player form
  for (let g = 1; g <= 12; g++) $('pf-grade').add(new Option(`Grade ${g}`, String(g)));
  $('profile-form').addEventListener('submit', (e) => { e.preventDefault(); submitProfileForm(); });
  $('pf-cancel').addEventListener('click', () => (state.editing ? openDashboard() : openProfiles()));
  $('pf-delete').addEventListener('click', async () => {
    const p = P.active();
    if (!p || !confirm(`Delete ${p.name} and all of their progress? This can't be undone.`)) return;
    try { await P.removeMe(); openProfiles(); }
    catch (e) { showError('pf-error', e.message); }
  });

  // Login
  $('login-form').addEventListener('submit', (e) => { e.preventDefault(); submitLogin(); });
  $('login-back').addEventListener('click', openProfiles);

  // Header and player screen
  $('player-chip').addEventListener('click', () => { if (okToLeaveQuiz()) openDashboard(); });
  $('switch-btn').addEventListener('click', () => {
    if (!okToLeaveQuiz()) return;
    if (P.active()) logout(); else openProfiles();
  });
  $('guest-btn').addEventListener('click', () => { P.logout(); openSetup(); });
  $('home-link').addEventListener('click', (e) => { e.preventDefault(); if (okToLeaveQuiz()) openSetup(); });

  // Dashboard
  $('dash-practice').addEventListener('click', () => openSetup());
  $('dash-edit').addEventListener('click', () => openProfileForm(true));
  $('add-goal-btn').addEventListener('click', openGoalForm);
  $('goal-type').addEventListener('change', syncGoalForm);
  $('goal-cancel').addEventListener('click', () => { $('goal-form').hidden = true; });
  $('goal-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const p = P.active();
    const type = $('goal-type').value;
    const [, min, max] = P.GOAL_TYPES[type].target;
    const target = Math.round(+$('goal-target').value);
    if (!(target >= min && target <= max)) { $('goal-target').reportValidity(); return; }
    const topic = type === 'score' ? $('goal-topic').value : 'any';
    P.addGoal(p, { type, target, topic, grade: p.grade, topicLabel: topicName(topic) });
    $('goal-form').hidden = true;
    renderGoals(p);
  });

  // Setup and quiz
  $('start-btn').addEventListener('click', () => startQuiz());
  $('answer-input').addEventListener('input', (e) => {
    state.answers[state.index] = e.target.value;
    $('progress-bar').style.width = `${(answeredCount() / state.questions.length) * 100}%`;
    const dot = $('dots').children[state.index];
    if (dot) dot.classList.toggle('answered', !!state.answers[state.index].trim());
  });
  $('answer-form').addEventListener('submit', (e) => { e.preventDefault(); next(); });
  $('next-btn').addEventListener('click', next);
  $('prev-btn').addEventListener('click', () => { if (state.index > 0) goTo(state.index - 1); });
  $('goto-unanswered-btn').addEventListener('click', () => goTo(state.answers.findIndex((a) => !a.trim())));
  $('grade-anyway-btn').addEventListener('click', grade);
  $('quit-btn').addEventListener('click', () => {
    if (confirm('Quit this quiz? Your answers will be lost.')) openSetup();
  });

  // Results
  $('retry-btn').addEventListener('click', () => startQuiz(true));
  $('new-btn').addEventListener('click', () => startQuiz());
  $('change-btn').addEventListener('click', () => openSetup());
  $('results-progress-btn').addEventListener('click', openDashboard);

  // Save problems show as a message at the bottom of the screen.
  let toastTimer;
  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 8000);
  }
  P.onError = toast;
  P.onSignedOut = (message) => { toast(message); openProfiles(); };

  // Load the players, then start on "Who's practicing?" (or keep going if
  // this browser tab is already logged in, e.g. after a page refresh).
  P.init().then(() => {
    if (P.active()) openSetup();
    else openProfiles();
  });
})();
