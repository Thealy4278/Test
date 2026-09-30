/* Math Quest – player logins, quiz history, and goals.
 *
 * Players, quizzes, and goals are saved in the SQLite database by server.js.
 * A player logs in with their password; the login lasts until the browser is
 * closed (or they press Log out), so they sign in again each time they come back.
 *
 * After logging in, the site works from an in-memory copy of that player's
 * profile. Each change updates the copy right away and is saved in the
 * background, in order.
 */
(function () {
  'use strict';

  const SESSION_KEY = 'mathquest-session';
  const AVATARS = ['🦊', '🐼', '🐯', '🦄', '🐸', '🐙', '🦁', '🐧', '🐨', '🐲', '🚀', '⭐'];

  let online = false;   // is the Math Quest server reachable?
  let players = [];     // public list for the "Who's practicing?" screen
  let current = null;   // the logged-in player's full profile
  let token = null;
  let writes = Promise.resolve();

  const readSession = () => { try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; } };
  const writeSession = (value) => {
    try { if (value) sessionStorage.setItem(SESSION_KEY, value); else sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* unavailable */ }
  };

  async function request(method, url, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url, { method, headers, cache: 'no-store', body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Loads the player list, and the logged-in player if this tab already signed in.
  async function init() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
    try { players = await request('GET', 'api/players'); online = true; } catch (e) { return false; }
    token = readSession();
    if (token) {
      try { current = await request('GET', 'api/me'); }
      catch (e) { token = null; writeSession(null); }
    }
    return true;
  }

  async function refreshPlayers() {
    try { players = await request('GET', 'api/players'); } catch (e) { /* keep the old list */ }
    return players;
  }

  function signIn(result) {
    token = result.token;
    writeSession(token);
    current = result.profile;
    return current;
  }

  function signOut() {
    token = null;
    writeSession(null);
    current = null;
  }

  // Saves one change in the background. Problems are reported to the app.
  function save(method, url, body) {
    writes = writes
      .then(() => request(method, url, body))
      .catch((e) => {
        const api = window.MathProfiles;
        if (e.status === 401) {
          signOut();
          if (api.onSignedOut) api.onSignedOut('Your login ended, so that last change was not saved. Please log in again.');
        } else if (api.onError) {
          api.onError(`Couldn't save (${e.message}). Is the Math Quest server still running?`);
        }
      });
    return writes;
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function letterFor(pct) {
    if (pct >= 90) return 'A';
    if (pct >= 80) return 'B';
    if (pct >= 70) return 'C';
    if (pct >= 60) return 'D';
    return 'F';
  }

  // ---------- streaks ----------
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

  // Days in a row with at least one quiz. Today not practiced yet doesn't break it.
  function streak(history) {
    const days = new Set(history.map((h) => dayKey(h.at)));
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
    let count = 0;
    while (days.has(dayKey(d))) { count++; d.setDate(d.getDate() - 1); }
    return count;
  }

  // ---------- stats ----------
  function stats(p) {
    const h = p.history;
    const total = h.length;
    const byTopic = {};
    for (const x of h) {
      const k = `${x.grade}|${x.topic}`;
      const t = byTopic[k] || (byTopic[k] = { grade: x.grade, topic: x.topic, label: x.topicLabel, count: 0, sum: 0, best: 0, last: 0 });
      t.count++; t.sum += x.pct; t.best = Math.max(t.best, x.pct); t.last = x.at;
    }
    const topics = Object.values(byTopic)
      .map((t) => ({ ...t, avg: Math.round(t.sum / t.count) }))
      .sort((a, b) => a.grade - b.grade || a.label.localeCompare(b.label));
    return {
      total,
      avg: total ? Math.round(h.reduce((s, x) => s + x.pct, 0) / total) : 0,
      best: total ? Math.max(...h.map((x) => x.pct)) : 0,
      aCount: h.filter((x) => x.pct >= 90).length,
      streak: streak(h),
      topics,
    };
  }

  // ---------- goals ----------
  // Goals count quizzes finished after the goal was made (streaks count all days).
  const GOAL_TYPES = {
    quizzes: { label: 'Finish some quizzes', target: [5, 1, 100], ask: 'How many quizzes?' },
    score:   { label: 'Reach a score',       target: [90, 50, 100], ask: 'What score (%)?' },
    aGrades: { label: "Earn A's",            target: [3, 1, 50], ask: "How many A's?" },
    streak:  { label: 'Practice every day',  target: [3, 2, 30], ask: 'How many days in a row?' },
  };

  function describeGoal(g) {
    const t = g.target;
    if (g.type === 'quizzes') return `Finish ${t} ${t === 1 ? 'quiz' : 'quizzes'}`;
    if (g.type === 'score') return `Score ${t}% or better on ${g.topic === 'any' ? 'any quiz' : `Grade ${g.grade} ${g.topicLabel}`}`;
    if (g.type === 'aGrades') return `Earn ${t} ${t === 1 ? 'A' : 'A’s'}`;
    return `Practice ${t} days in a row`;
  }

  function goalProgress(p, g) {
    const since = p.history.filter((h) => h.at >= g.createdAt);
    let current;
    if (g.type === 'quizzes') current = since.length;
    else if (g.type === 'aGrades') current = since.filter((h) => h.pct >= 90).length;
    else if (g.type === 'streak') current = streak(p.history);
    else {
      const matches = since.filter((h) => g.topic === 'any' || (h.topic === g.topic && h.grade === g.grade));
      current = matches.length ? Math.max(...matches.map((h) => h.pct)) : 0;
    }
    const done = !!g.completedAt || current >= g.target;
    const shown = done ? Math.max(current, g.target) : current;
    const unit = g.type === 'score' ? '%' : g.type === 'streak' ? ' days' : '';
    const text = g.type === 'score'
      ? `Best so far: ${current}% · goal ${g.target}%`
      : `${Math.min(shown, g.target)} of ${g.target}${unit}`;
    return { current, done, fraction: done ? 1 : Math.min(1, current / g.target), text };
  }

  // ---------- public API ----------
  window.MathProfiles = {
    AVATARS,
    GOAL_TYPES,
    letterFor,
    describeGoal,
    goalProgress,
    stats,
    init,
    refreshPlayers,
    onError: null,      // set by the app: shows save problems
    onSignedOut: null,  // set by the app: the login ended on the server

    online: () => online,
    players: () => players,
    active: () => current,

    // Throws an Error with a friendly message if the password is wrong.
    async login(playerId, password) {
      signIn(await request('POST', 'api/login', { id: playerId, password }));
      refreshPlayers();
      return current;
    },

    logout() {
      if (token) request('POST', 'api/logout', {}).catch(() => {});
      signOut();
    },

    // Creates a player and logs them in. Throws if the name is taken.
    async create({ name, avatar, grade, password }) {
      signIn(await request('POST', 'api/players', { name, avatar, grade, password }));
      await refreshPlayers();
      return current;
    },

    // Edits name, avatar, grade, and optionally the password. Throws on problems.
    async edit(fields) {
      await request('PATCH', 'api/me', fields);
      const { password, ...rest } = fields;
      Object.assign(current, rest);
      await refreshPlayers();
      return current;
    },

    // Remembers the last grade/topic/count picked (saved in the background).
    saveLast(last) {
      if (!current) return;
      current.last = last;
      save('PATCH', 'api/me', { last });
    },

    async removeMe() {
      await request('DELETE', 'api/me');
      signOut();
      await refreshPlayers();
    },

    // Saves a finished quiz and returns any goals it just completed.
    recordQuiz(p, entry) {
      p.history.push(entry);
      const completed = [];
      for (const g of p.goals) {
        if (!g.completedAt && goalProgress(p, g).done) { g.completedAt = entry.at; completed.push(g); }
      }
      save('POST', 'api/me/quizzes', {
        quiz: entry,
        completedGoals: completed.map((g) => ({ id: g.id, completedAt: g.completedAt })),
      });
      return completed;
    },

    addGoal(p, goal) {
      const g = { id: uid(), createdAt: Date.now(), completedAt: null, ...goal };
      p.goals.push(g);
      save('POST', 'api/me/goals', { goal: g });
      return g;
    },

    removeGoal(p, goalId) {
      p.goals = p.goals.filter((g) => g.id !== goalId);
      save('DELETE', `api/me/goals/${goalId}`);
    },
  };
})();
