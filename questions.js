/* Math Quest – question generators and answer checking.
 *
 * Every generator returns an object:
 *   text     HTML shown to the student
 *   answer   a number, or an array of numbers for multi-part answers
 *   display  (optional) the correct answer as shown on the results page
 *   hint     (optional) how to type the answer
 *   tol      (optional) how close a typed answer must be (for rounded answers)
 *   ordered  (optional) true when a multi-part answer must be in order, e.g. (x, y)
 *
 * To add a topic: add an entry to TOPICS, then list its id under the grades in GRADES.
 */
(function () {
  'use strict';

  // ---------- helpers ----------
  const R = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const nonZero = (min, max) => { let v; do { v = R(min, max); } while (v === 0); return v; };
  const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
  const roundTo = (x, places) => { const f = 10 ** places; return Math.round(x * f) / f; };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = R(0, i); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };
  const ord = (k) => { const s = ['th', 'st', 'nd', 'rd'], v = k % 100; return k + (s[(v - 20) % 10] || s[v] || s[0]); };

  // Display helpers
  const n = (x) => (x < 0 ? `−${Math.abs(x)}` : `${x}`);   // proper minus sign
  const p = (x) => (x < 0 ? `(${n(x)})` : n(x));           // parenthesize negatives
  const fracText = (num, den) => {
    if (den < 0) { num = -num; den = -den; }
    const g = gcd(num, den);
    num /= g; den /= g;
    return den === 1 ? n(num) : `${n(num)}/${den}`;
  };
  const fracHTML = (top, bottom) => `<span class="frac"><span>${top}</span><span>${bottom}</span></span>`;
  const sqrtHTML = (x, sym = '√') => `${sym}<span class="radicand">${x}</span>`;
  const BLANK = '<span class="blank"></span>';
  const sup = (e) => `<sup>${e}</sup>`;
  const X2 = `x${sup(2)}`;

  // Format a polynomial from [[coef, variableHTML], ...], skipping zero terms.
  function poly(terms) {
    let out = '';
    for (const [c, v] of terms) {
      if (c === 0) continue;
      const abs = Math.abs(c);
      const body = v && abs === 1 ? v : `${abs}${v}`;
      out += out ? (c < 0 ? ' − ' : ' + ') + body : (c < 0 ? '−' : '') + body;
    }
    return out || '0';
  }

  const HINT_FRAC = 'Type a fraction like 3/4, or a whole number. Any equivalent answer is OK.';
  const HINT_TWO = 'Type both answers separated by a comma, like 2, −5.';
  const HINT_PI = 'Use π ≈ 3.14.';
  const HINT_NUM = 'Type just the number.';

  // Fraction arithmetic on [num, den] pairs.
  function fracOp([a, b], [c, d], op) {
    if (op === '+') return [a * d + c * b, b * d];
    if (op === '−') return [a * d - c * b, b * d];
    if (op === '×') return [a * c, b * d];
    return [a * d, b * c]; // ÷
  }

  // ---------- topics ----------
  const TOPICS = {};

  TOPICS.add = { label: 'Addition', gen(g) {
    const [lo, hi] = g === 1 ? [0, 10] : g === 2 ? [10, 99] : [100, 999];
    const a = R(lo, hi), b = R(lo, hi);
    return { text: `${a} + ${b} = ?`, answer: a + b };
  } };

  TOPICS.sub = { label: 'Subtraction', gen(g) {
    const [lo, hi] = g === 1 ? [5, 20] : g === 2 ? [20, 99] : [200, 999];
    const a = R(lo, hi), b = R(g === 1 ? 0 : Math.floor(lo / 2), a);
    return { text: `${a} − ${b} = ?`, answer: a - b };
  } };

  TOPICS.missing = { label: 'Missing Numbers', gen() {
    const a = R(0, 10), b = R(0, 10), c = a + b;
    return pick([
      { text: `${a} + ${BLANK} = ${c}`, answer: b },
      { text: `${BLANK} + ${b} = ${c}`, answer: a },
      { text: `${c} − ${BLANK} = ${a}`, answer: b },
    ]);
  } };

  TOPICS.placeValue = { label: 'Place Value', gen() {
    const num = R(100, 999);
    const digits = String(num).split('').map(Number);
    const places = ['hundreds', 'tens', 'ones'];
    const i = R(0, 2);
    if (Math.random() < 0.5) {
      return { text: `What digit is in the <b>${places[i]}</b> place in ${num}?`, answer: digits[i] };
    }
    const marked = digits.map((d, j) => (j === i ? `<u>${d}</u>` : d)).join('');
    return { text: `What is the value of the underlined digit?<br>${marked}`, answer: digits[i] * 10 ** (2 - i) };
  } };

  TOPICS.skipCount = { label: 'Skip Counting', gen() {
    const step = pick([2, 3, 5, 10, 100]);
    const start = step * R(0, 10);
    const seq = Array.from({ length: 5 }, (_, i) => start + step * i);
    const hole = R(1, 4);
    const shown = seq.map((v, i) => (i === hole ? BLANK : v)).join(', ');
    return { text: `Fill in the missing number:<br>${shown}`, answer: seq[hole] };
  } };

  TOPICS.mult = { label: 'Multiplication', gen(g) {
    let a, b;
    if (g <= 3) { a = R(0, 10); b = R(0, 10); }
    else if (g === 4) [a, b] = pick([[R(11, 99), R(2, 9)], [R(11, 99), R(11, 99)], [R(100, 999), R(2, 9)]]);
    else { a = R(100, 999); b = R(11, 99); }
    return { text: `${a} × ${b} = ?`, answer: a * b };
  } };

  TOPICS.div = { label: 'Division', gen(g) {
    let b, q;
    if (g <= 3) { b = R(1, 10); q = R(0, 10); }
    else if (g === 4) { b = R(2, 9); q = R(10, 199); }
    else { b = R(11, 25); q = R(10, 99); }
    return { text: `${b * q} ÷ ${b} = ?`, answer: q };
  } };

  TOPICS.round = { label: 'Rounding', gen() {
    const num = R(101, 989), to = pick([10, 100]);
    return { text: `Round ${num} to the nearest ${to}.`, answer: Math.round(num / to) * to };
  } };

  TOPICS.areaPerim = { label: 'Area & Perimeter', gen(g) {
    const l = R(2, g <= 3 ? 10 : 25), w = R(1, l);
    const u = pick(['cm', 'm', 'in', 'ft']);
    const shape = `A rectangle is ${l} ${u} long and ${w} ${u} wide.`;
    const t = g <= 3 ? R(0, 1) : R(0, 2);
    if (t === 0) return { text: `${shape} What is its <b>area</b>?`, answer: l * w, display: `${l * w} sq ${u}`, hint: HINT_NUM };
    if (t === 1) return { text: `${shape} What is its <b>perimeter</b>?`, answer: 2 * (l + w), display: `${2 * (l + w)} ${u}`, hint: HINT_NUM };
    return { text: `A rectangle has an area of ${l * w} sq ${u}. It is ${l} ${u} long. How <b>wide</b> is it?`, answer: w, display: `${w} ${u}`, hint: HINT_NUM };
  } };

  TOPICS.fractions = { label: 'Fractions', gen(g) {
    if (g <= 4) {
      if (Math.random() < 0.5) {
        const d = R(2, 8), a = R(1, d - 1), k = R(2, 5);
        return { text: `${fracHTML(a, d)} = ${fracHTML(BLANK, d * k)}`, answer: a * k, hint: 'What number goes in the box?' };
      }
      const d = R(3, 12);
      let a = R(1, d - 1), b = R(1, d - 1);
      const op = pick(['+', '−']);
      if (op === '−' && a < b) [a, b] = [b, a];
      const num = op === '+' ? a + b : a - b;
      return { text: `${fracHTML(a, d)} ${op} ${fracHTML(b, d)} = ?`, answer: num / d, display: fracText(num, d), hint: HINT_FRAC };
    }
    const d1 = R(2, 10), d2 = R(2, 10);
    let x = [R(1, d1 - 1), d1], y = [R(1, d2 - 1), d2];
    const op = g === 5 ? pick(['+', '−', '×']) : pick(['×', '÷', '+', '−']);
    if (op === '−' && x[0] * y[1] < y[0] * x[1]) [x, y] = [y, x];
    const [num, den] = fracOp(x, y, op);
    return { text: `${fracHTML(x[0], x[1])} ${op} ${fracHTML(y[0], y[1])} = ?`, answer: num / den, display: fracText(num, den), hint: HINT_FRAC };
  } };

  TOPICS.decimals = { label: 'Decimals', gen() {
    const op = pick(['+', '−', '×']);
    if (op === '×') {
      const a = R(11, 99) / 10, b = R(2, 9);
      return { text: `${a} × ${b} = ?`, answer: roundTo(a * b, 2) };
    }
    let a = R(100, 999) / 100, b = R(10, 999) / 100;
    if (op === '−' && a < b) [a, b] = [b, a];
    return { text: `${a} ${op} ${b} = ?`, answer: roundTo(op === '+' ? a + b : a - b, 2) };
  } };

  TOPICS.orderOps = { label: 'Order of Operations', gen() {
    const a = R(2, 9), b = R(2, 9), c = R(2, 9), d = R(1, 4);
    return pick([
      { text: `${a} + ${b} × ${c} = ?`, answer: a + b * c },
      { text: `(${a} + ${b}) × ${c} = ?`, answer: (a + b) * c },
      { text: `${a * c} ÷ ${c} + ${b} = ?`, answer: a + b },
      { text: `${a} × ${b} − ${d} = ?`, answer: a * b - d },
      { text: `${b * c + a} − ${b} × ${c} = ?`, answer: a },
      { text: `${a} + ${b}${sup(2)} = ?`, answer: a + b * b },
    ]);
  } };

  TOPICS.volume = { label: 'Volume', gen(g) {
    const u = pick(['cm', 'm', 'in', 'ft']);
    if (g < 8) {
      const l = R(2, 12), w = R(2, 12), h = R(2, 12);
      return { text: `A box is ${l} ${u} long, ${w} ${u} wide, and ${h} ${u} tall. What is its volume?`, answer: l * w * h, display: `${l * w * h} cubic ${u}`, hint: HINT_NUM };
    }
    const r = R(1, 10), h = R(2, 15);
    const hint = `${HINT_PI} Round to the nearest tenth.`;
    const shapes = [
      [`a cylinder with radius ${r} ${u} and height ${h} ${u}`, 3.14 * r * r * h],
      [`a cone with radius ${r} ${u} and height ${h} ${u}`, (3.14 * r * r * h) / 3],
      [`a sphere with radius ${r} ${u}`, (4 / 3) * 3.14 * r ** 3],
    ];
    const [desc, v] = pick(shapes);
    const ans = roundTo(v, 1);
    return { text: `What is the volume of ${desc}?`, answer: ans, display: `${ans} cubic ${u}`, hint, tol: 0.1 };
  } };

  TOPICS.ratios = { label: 'Ratios & Rates', gen() {
    const t = R(0, 2);
    if (t === 0) {
      const [many, one] = pick([['notebooks', 'notebook'], ['apples', 'apple'], ['pencils', 'pencil'], ['tickets', 'ticket']]);
      const qty = R(2, 9), each = R(2, 15);
      return { text: `${qty} ${many} cost $${qty * each}. How much does 1 ${one} cost?`, answer: each, display: `$${each}`, hint: HINT_NUM };
    }
    if (t === 1) {
      const a = R(1, 5), b = R(1, 7), k = R(2, 8);
      return { text: `The ratio of cats to dogs at a shelter is ${a}:${b}. If there are ${a * k} cats, how many dogs are there?`, answer: b * k };
    }
    const speed = R(20, 65), hrs = R(2, 6);
    return { text: `A car travels ${speed * hrs} miles in ${hrs} hours. What is its speed in miles per hour?`, answer: speed, display: `${speed} mph`, hint: HINT_NUM };
  } };

  TOPICS.percent = { label: 'Percents', gen(g) {
    if (g <= 6 || Math.random() < 0.4) {
      const pct = pick([5, 10, 20, 25, 40, 50, 60, 75]), base = R(1, 20) * 20;
      return { text: `What is ${pct}% of ${base}?`, answer: (pct * base) / 100 };
    }
    const orig = R(2, 20) * 10, pct = pick([10, 20, 25, 50]);
    const t = R(0, 2);
    if (t === 0) {
      const sale = roundTo(orig * (1 - pct / 100), 2);
      return { text: `A $${orig} jacket is on sale for ${pct}% off. What is the sale price?`, answer: sale, display: `$${sale}`, hint: HINT_NUM };
    }
    if (t === 1) {
      return { text: `A price goes up from $${orig} to $${roundTo(orig * (1 + pct / 100), 2)}. What is the percent increase?`, answer: pct, display: `${pct}%`, hint: HINT_NUM };
    }
    return { text: `A town's population drops from ${orig * 10} to ${orig * 10 * (1 - pct / 100)}. What is the percent decrease?`, answer: pct, display: `${pct}%`, hint: HINT_NUM };
  } };

  TOPICS.integers = { label: 'Integers', gen(g) {
    const op = pick(g <= 6 ? ['+', '−'] : ['+', '−', '×', '÷']);
    const a = nonZero(-20, 20), b = nonZero(-20, 20);
    if (op === '+') return { text: `${n(a)} + ${p(b)} = ?`, answer: a + b };
    if (op === '−') return { text: `${n(a)} − ${p(b)} = ?`, answer: a - b };
    const x = nonZero(-12, 12), y = nonZero(-12, 12);
    if (op === '×') return { text: `${n(x)} × ${p(y)} = ?`, answer: x * y };
    return { text: `${n(x * y)} ÷ ${p(y)} = ?`, answer: x };
  } };

  TOPICS.exponents = { label: 'Exponents', gen(g) {
    if (g <= 7) {
      const b = R(2, 10), e = b <= 3 ? R(2, 5) : R(2, 3);
      return { text: `${b}${sup(e)} = ?`, answer: b ** e };
    }
    const a = R(2, 9), b = R(2, 9);
    const hint = 'What is the missing exponent?';
    const nb = pick([2, 3, 5]), ne = nb === 2 ? R(1, 4) : R(1, 2);
    return pick([
      { text: `x${sup(a)} · x${sup(b)} = x${sup('?')}`, answer: a + b, hint },
      { text: `(x${sup(a)})${sup(b)} = x${sup('?')}`, answer: a * b, hint },
      { text: `x${sup(a + b)} ÷ x${sup(b)} = x${sup('?')}`, answer: a, hint },
      { text: `${R(2, 99)}${sup(0)} = ?`, answer: 1 },
      { text: `${nb}${sup(`−${ne}`)} = ?`, answer: 1 / nb ** ne, display: `1/${nb ** ne}`, hint: HINT_FRAC },
    ]);
  } };

  TOPICS.oneStep = { label: 'One-Step Equations', gen() {
    const x = R(1, 20), a = R(2, 12);
    const q = pick([
      { eq: `x + ${a} = ${x + a}`, answer: x },
      { eq: `x − ${a} = ${n(x - a)}`, answer: x },
      { eq: `${a}x = ${a * x}`, answer: x },
      { eq: `x ÷ ${a} = ${x}`, answer: x * a },
    ]);
    return { text: `Solve for x:<br>${q.eq}`, answer: q.answer };
  } };

  TOPICS.twoStep = { label: 'Two-Step Equations', gen() {
    const b = nonZero(-20, 20);
    if (Math.random() < 0.7) {
      const x = R(-10, 10), a = R(2, 9) * pick([1, -1]);
      return { text: `Solve for x:<br>${poly([[a, 'x'], [b, '']])} = ${n(a * x + b)}`, answer: x };
    }
    const a = R(2, 6), k = R(-8, 8);
    return { text: `Solve for x:<br>${fracHTML('x', a)} ${b < 0 ? '−' : '+'} ${Math.abs(b)} = ${n(k + b)}`, answer: a * k };
  } };

  TOPICS.multiStep = { label: 'Multi-Step Equations', gen() {
    const x = R(-10, 10);
    if (Math.random() < 0.5) {
      let a, c;
      do { a = nonZero(-9, 9); c = nonZero(-9, 9); } while (a === c);
      const b = R(-15, 15), d = a * x + b - c * x;
      return { text: `Solve for x:<br>${poly([[a, 'x'], [b, '']])} = ${poly([[c, 'x'], [d, '']])}`, answer: x };
    }
    const a = R(2, 9) * pick([1, -1]), b = nonZero(-9, 9);
    return { text: `Solve for x:<br>${n(a)}(x ${b < 0 ? '−' : '+'} ${Math.abs(b)}) = ${n(a * (x + b))}`, answer: x };
  } };

  TOPICS.proportions = { label: 'Proportions', gen() {
    if (Math.random() < 0.6) {
      let top, bot;
      do { bot = R(2, 9); top = R(1, 12); } while (gcd(top, bot) !== 1);
      const m1 = R(1, 5), m2 = R(2, 6);
      return { text: `Solve for x:<br>${fracHTML('x', bot * m1)} = ${fracHTML(top * m2, bot * m2)}`, answer: top * m1 };
    }
    const cups = R(1, 4), batch = pick([6, 8, 10, 12]), k = R(2, 5);
    return { text: `A recipe uses ${cups} cup${cups > 1 ? 's' : ''} of flour to make ${batch} muffins. How many cups are needed for ${batch * k} muffins?`, answer: cups * k };
  } };

  TOPICS.circles = { label: 'Circles', gen() {
    const r = R(1, 15), u = pick(['cm', 'm', 'in', 'ft']);
    const given = Math.random() < 0.4 ? `a diameter of ${2 * r} ${u}` : `a radius of ${r} ${u}`;
    if (Math.random() < 0.5) {
      const ans = roundTo(3.14 * r * r, 2);
      return { text: `A circle has ${given}. What is its <b>area</b>?`, answer: ans, display: `${ans} sq ${u}`, hint: HINT_PI, tol: 0.01 };
    }
    const ans = roundTo(2 * 3.14 * r, 2);
    return { text: `A circle has ${given}. What is its <b>circumference</b>?`, answer: ans, display: `${ans} ${u}`, hint: HINT_PI, tol: 0.01 };
  } };

  TOPICS.slope = { label: 'Slope', gen() {
    const x1 = R(-9, 9), y1 = R(-9, 9), y2 = R(-9, 9);
    let x2; do { x2 = R(-9, 9); } while (x2 === x1);
    return {
      text: `What is the slope of the line through (${n(x1)}, ${n(y1)}) and (${n(x2)}, ${n(y2)})?`,
      answer: (y2 - y1) / (x2 - x1), display: fracText(y2 - y1, x2 - x1), hint: HINT_FRAC,
    };
  } };

  TOPICS.pythag = { label: 'Pythagorean Theorem', gen() {
    const [a, b, c] = pick([[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 8, 10], [9, 12, 15]]);
    const k = R(1, 3);
    if (Math.random() < 0.5) {
      return { text: `A right triangle has legs of ${a * k} and ${b * k}. How long is the hypotenuse?`, answer: c * k };
    }
    return { text: `A right triangle has a hypotenuse of ${c * k} and one leg of ${a * k}. How long is the other leg?`, answer: b * k };
  } };

  TOPICS.roots = { label: 'Square & Cube Roots', gen() {
    if (Math.random() < 0.7) { const r = R(1, 20); return { text: `${sqrtHTML(r * r)} = ?`, answer: r }; }
    const r = R(1, 6);
    return { text: `${sqrtHTML(r ** 3, '∛')} = ?`, answer: r };
  } };

  TOPICS.linearFunc = { label: 'Linear Functions', gen() {
    const m = nonZero(-6, 6), b = R(-10, 10), x = R(-6, 6);
    const f = poly([[m, 'x'], [b, '']]);
    return pick([
      { text: `If f(x) = ${f}, what is f(${n(x)})?`, answer: m * x + b },
      { text: `What is the y-intercept of y = ${f}?`, answer: b },
      { text: `What is the slope of y = ${f}?`, answer: m },
      { text: `If f(x) = ${f}, what value of x makes f(x) = ${n(m * x + b)}?`, answer: x },
    ]);
  } };

  TOPICS.systems = { label: 'Systems of Equations', gen(g) {
    const x = R(-8, 8), y = R(-8, 8), lim = g <= 9 ? 3 : 5;
    let a1, b1, a2, b2;
    do { a1 = nonZero(-lim, lim); b1 = nonZero(-lim, lim); a2 = nonZero(-lim, lim); b2 = nonZero(-lim, lim); }
    while (a1 * b2 - a2 * b1 === 0);
    return {
      text: `Solve the system:<br>${poly([[a1, 'x'], [b1, 'y']])} = ${n(a1 * x + b1 * y)}<br>${poly([[a2, 'x'], [b2, 'y']])} = ${n(a2 * x + b2 * y)}`,
      answer: [x, y], ordered: true, display: `x = ${n(x)}, y = ${n(y)}`,
      hint: 'Type x, then y, separated by a comma (like 3, −2).',
    };
  } };

  TOPICS.quadratic = { label: 'Quadratic Equations', gen(g) {
    if (g <= 9 || Math.random() < 0.3) {
      const r1 = R(-9, 9), r2 = R(-9, 9);
      return {
        text: `Solve for x:<br>${poly([[1, X2], [-(r1 + r2), 'x'], [r1 * r2, '']])} = 0`,
        answer: [r1, r2], display: r1 === r2 ? n(r1) : `${n(r1)}, ${n(r2)}`, hint: HINT_TWO,
      };
    }
    let a, b, c, D;
    do { a = R(1, 3); b = R(-9, 9); c = R(-9, 9); D = b * b - 4 * a * c; } while (D <= 0 || Number.isInteger(Math.sqrt(D)));
    const s = Math.sqrt(D);
    const roots = [roundTo((-b + s) / (2 * a), 2), roundTo((-b - s) / (2 * a), 2)];
    return {
      text: `Solve for x using the quadratic formula:<br>${poly([[a, X2], [b, 'x'], [c, '']])} = 0`,
      answer: roots, display: roots.map(n).join(', '), tol: 0.01,
      hint: 'Round to the nearest hundredth. Separate the two answers with a comma.',
    };
  } };

  TOPICS.polyEval = { label: 'Evaluating Polynomials', gen() {
    const a = nonZero(-4, 4), b = R(-6, 6), c = R(-9, 9), x = R(-4, 4);
    return { text: `Evaluate ${poly([[a, X2], [b, 'x'], [c, '']])} when x = ${n(x)}.`, answer: a * x * x + b * x + c };
  } };

  TOPICS.angles = { label: 'Angles', gen() {
    const deg = (v) => `${v}°`;
    const t = R(0, 3);
    if (t === 0) {
      const A = R(20, 100), B = R(20, 160 - A);
      return { text: `A triangle has angles of ${A}° and ${B}°. What is the third angle?`, answer: 180 - A - B, display: deg(180 - A - B), hint: HINT_NUM };
    }
    if (t === 1) { const A = R(10, 170); return { text: `Two angles are supplementary. One measures ${A}°. What does the other measure?`, answer: 180 - A, display: deg(180 - A), hint: HINT_NUM }; }
    if (t === 2) { const A = R(5, 85); return { text: `Two angles are complementary. One measures ${A}°. What does the other measure?`, answer: 90 - A, display: deg(90 - A), hint: HINT_NUM }; }
    const names = { 3: 'triangle', 4: 'quadrilateral', 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon', 9: 'nonagon', 10: 'decagon', 12: 'dodecagon' };
    const sides = pick(Object.keys(names).map(Number));
    return { text: `What is the sum of the interior angles of a ${names[sides]}?`, answer: (sides - 2) * 180, display: deg((sides - 2) * 180), hint: HINT_NUM };
  } };

  TOPICS.distance = { label: 'Distance & Midpoint', gen() {
    const x1 = R(-9, 9), y1 = R(-9, 9);
    if (Math.random() < 0.5) {
      const [dx, dy, d] = pick([[3, 4, 5], [4, 3, 5], [6, 8, 10], [8, 6, 10], [5, 12, 13], [12, 5, 13]]);
      const x2 = x1 + dx * pick([1, -1]), y2 = y1 + dy * pick([1, -1]);
      return { text: `What is the distance between (${n(x1)}, ${n(y1)}) and (${n(x2)}, ${n(y2)})?`, answer: d };
    }
    const x2 = x1 + 2 * R(-5, 5), y2 = y1 + 2 * R(-5, 5);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return {
      text: `What is the midpoint of (${n(x1)}, ${n(y1)}) and (${n(x2)}, ${n(y2)})?`,
      answer: [mx, my], ordered: true, display: `(${n(mx)}, ${n(my)})`,
      hint: 'Type the x-coordinate, then the y-coordinate, separated by a comma.',
    };
  } };

  TOPICS.areaGeom = { label: 'Area', gen() {
    const u = pick(['cm', 'm', 'in', 'ft']);
    const t = R(0, 3);
    let text, ans, extra = {};
    if (t === 0) { const b = R(2, 20), h = R(2, 20); text = `A triangle has a base of ${b} ${u} and a height of ${h} ${u}. What is its area?`; ans = (b * h) / 2; }
    else if (t === 1) { const b1 = R(2, 15), b2 = R(2, 15), h = R(2, 12); text = `A trapezoid has bases of ${b1} ${u} and ${b2} ${u} and a height of ${h} ${u}. What is its area?`; ans = ((b1 + b2) * h) / 2; }
    else if (t === 2) { const b = R(2, 20), h = R(2, 15); text = `A parallelogram has a base of ${b} ${u} and a height of ${h} ${u}. What is its area?`; ans = b * h; }
    else { const r = R(1, 12); text = `A circle has a radius of ${r} ${u}. What is its area?`; ans = roundTo(3.14 * r * r, 2); extra = { hint: HINT_PI, tol: 0.01 }; }
    return { text, answer: ans, display: `${ans} sq ${u}`, hint: HINT_NUM, ...extra };
  } };

  TOPICS.trig = { label: 'Trigonometry', gen(g) {
    if (g >= 11 && Math.random() < 0.4) {
      const [f, deg, v] = pick([
        ['sin', 30, 0.5], ['cos', 60, 0.5], ['tan', 45, 1], ['sin', 90, 1], ['cos', 0, 1], ['cos', 180, -1],
        ['sin', 0, 0], ['sin', 150, 0.5], ['cos', 120, -0.5], ['tan', 135, -1], ['sin', 270, -1], ['sin', 210, -0.5],
      ]);
      return { text: `${f}(${deg}°) = ?`, answer: v, display: fracText(v * 2, 2), hint: 'Type a decimal or a fraction.' };
    }
    const angle = R(15, 75), side = R(5, 30), rad = (angle * Math.PI) / 180;
    const hint = 'Round to the nearest tenth.';
    const intro = `In a right triangle, one angle is ${angle}°`;
    return pick([
      { text: `${intro} and the hypotenuse is ${side}. How long is the side <b>opposite</b> the ${angle}° angle?`, answer: roundTo(side * Math.sin(rad), 1) },
      { text: `${intro} and the hypotenuse is ${side}. How long is the side <b>adjacent</b> to the ${angle}° angle?`, answer: roundTo(side * Math.cos(rad), 1) },
      { text: `${intro} and the side adjacent to it is ${side}. How long is the side <b>opposite</b> that angle?`, answer: roundTo(side * Math.tan(rad), 1) },
    ].map((q) => ({ ...q, hint, tol: 0.1 })));
  } };

  TOPICS.logs = { label: 'Logarithms', gen() {
    const b = pick([2, 3, 4, 5, 10]);
    const k = b === 2 ? R(0, 8) : b === 10 ? R(0, 6) : R(0, 4);
    const k1 = Math.max(k, 1);
    return pick([
      { text: `log<sub>${b}</sub> ${b ** k} = ?`, answer: k },
      { text: `If log<sub>${b}</sub> x = ${k}, what is x?`, answer: b ** k },
      { text: `log<sub>${b}</sub> ${fracHTML(1, b ** k1)} = ?`, answer: -k1 },
    ]);
  } };

  TOPICS.expEq = { label: 'Exponential Equations', gen() {
    const b = pick([2, 3, 5]), k = b === 2 ? R(2, 8) : R(2, 4), c = R(-3, 3);
    return { text: `Solve for x:<br>${b}${sup(poly([[1, 'x'], [c, '']]))} = ${b ** k}`, answer: k - c };
  } };

  TOPICS.funcComp = { label: 'Function Composition', gen() {
    const a = nonZero(-5, 5), b = R(-9, 9), c = R(-5, 5), k = R(-4, 4);
    const defs = `f(x) = ${poly([[a, 'x'], [b, '']])} and g(x) = ${poly([[1, X2], [c, '']])}.`;
    if (Math.random() < 0.5) return { text: `Let ${defs}<br>What is f(g(${n(k)}))?`, answer: a * (k * k + c) + b };
    return { text: `Let ${defs}<br>What is g(f(${n(k)}))?`, answer: (a * k + b) ** 2 + c };
  } };

  TOPICS.sequences = { label: 'Sequences & Series', gen() {
    const t = R(0, 2);
    if (t === 1) {
      const a1 = R(1, 5), r = pick([2, 3, -2]), k = R(4, 7);
      return { text: `A geometric sequence starts ${n(a1)}, ${n(a1 * r)}, ${n(a1 * r * r)}, … What is the ${ord(k)} term?`, answer: a1 * r ** (k - 1) };
    }
    const a1 = R(-10, 20), d = nonZero(-6, 8), k = R(8, 30);
    const start = `${n(a1)}, ${n(a1 + d)}, ${n(a1 + 2 * d)}, …`;
    if (t === 0) return { text: `An arithmetic sequence starts ${start} What is the ${ord(k)} term?`, answer: a1 + (k - 1) * d };
    return { text: `Find the sum of the first ${k} terms of the arithmetic sequence ${start}`, answer: (k * (2 * a1 + (k - 1) * d)) / 2 };
  } };

  TOPICS.derivatives = { label: 'Derivatives', gen() {
    const a = nonZero(-5, 5), e = R(2, 4), b = R(-9, 9), c = R(-9, 9), x = R(-3, 3);
    return {
      text: `If f(x) = ${poly([[a, `x${sup(e)}`], [b, 'x'], [c, '']])}, what is f′(${n(x)})?`,
      answer: a * e * x ** (e - 1) + b,
    };
  } };

  TOPICS.limits = { label: 'Limits', gen() {
    const t = R(0, 2);
    if (t === 0) {
      const a = nonZero(-6, 6);
      return { text: `lim<sub>x→${n(a)}</sub> ${fracHTML(poly([[1, X2], [-a * a, '']]), poly([[1, 'x'], [-a, '']]))} = ?`, answer: 2 * a };
    }
    if (t === 1) {
      const a = R(-4, 4), b = nonZero(-4, 4), c = R(-6, 6), d = R(-9, 9);
      return { text: `lim<sub>x→${n(a)}</sub> (${poly([[b, X2], [c, 'x'], [d, '']])}) = ?`, answer: b * a * a + c * a + d };
    }
    const pc = nonZero(-9, 9), qc = R(1, 9);
    const top = poly([[pc, X2], [R(-9, 9), 'x'], [R(-9, 9), '']]);
    const bot = poly([[qc, X2], [R(-9, 9), 'x'], [nonZero(-9, 9), '']]);
    return { text: `lim<sub>x→∞</sub> ${fracHTML(top, bot)} = ?`, answer: pc / qc, display: fracText(pc, qc), hint: HINT_FRAC };
  } };

  // ---------- grade → topics ----------
  const GRADES = {
    1: ['add', 'sub', 'missing'],
    2: ['add', 'sub', 'placeValue', 'skipCount'],
    3: ['add', 'sub', 'mult', 'div', 'round', 'areaPerim'],
    4: ['mult', 'div', 'fractions', 'areaPerim'],
    5: ['decimals', 'fractions', 'mult', 'div', 'orderOps', 'volume'],
    6: ['ratios', 'percent', 'integers', 'fractions', 'exponents', 'oneStep', 'orderOps'],
    7: ['integers', 'twoStep', 'proportions', 'percent', 'circles'],
    8: ['multiStep', 'slope', 'pythag', 'exponents', 'roots', 'volume'],
    9: ['multiStep', 'linearFunc', 'slope', 'systems', 'quadratic', 'polyEval', 'exponents'],
    10: ['angles', 'pythag', 'areaGeom', 'volume', 'distance', 'trig'],
    11: ['quadratic', 'systems', 'funcComp', 'logs', 'expEq', 'sequences', 'trig'],
    12: ['trig', 'logs', 'sequences', 'derivatives', 'limits'],
  };

  // ---------- quiz building ----------
  const fmt = (x) => n(roundTo(x, 4));

  function generateQuiz(grade, topicId, count) {
    const pool = GRADES[grade];
    const base = shuffle(pool);
    const ids = topicId === 'mixed'
      ? shuffle(Array.from({ length: count }, (_, i) => base[i % base.length]))
      : Array(count).fill(topicId);
    const seen = new Set();
    return ids.map((id) => {
      let q, tries = 0;
      do { q = TOPICS[id].gen(grade); } while (seen.has(q.text) && ++tries < 25);
      seen.add(q.text);
      if (q.display === undefined) q.display = Array.isArray(q.answer) ? q.answer.map(fmt).join(', ') : fmt(q.answer);
      q.topic = TOPICS[id].label;
      return q;
    });
  }

  // ---------- answer checking ----------
  const isPlainNumber = (s) => /^[+-]?(\d+\.?\d*|\.\d+)$/.test(s);

  // Accepts whole numbers, decimals, fractions (3/4), mixed numbers (1 1/2),
  // and ignores things like "x =", "$", "%", "°" and trailing units ("12 cm").
  function parseNumber(raw) {
    let s = String(raw).trim()
      .replace(/[−–—]/g, '-')
      .replace(/^[a-z]\s*=\s*/i, '')
      .replace(/[$%°]/g, '')
      .replace(/\s*[a-z][a-z.\s²³]*$/i, '')
      .trim();
    let m = s.match(/^([+-]?)(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (m) { const v = +m[2] + +m[3] / +m[4]; return m[1] === '-' ? -v : v; }
    s = s.replace(/\s+/g, '');
    m = s.match(/^([^/]+)\/([^/]+)$/);
    if (m) {
      if (!isPlainNumber(m[1]) || !isPlainNumber(m[2]) || parseFloat(m[2]) === 0) return NaN;
      return parseFloat(m[1]) / parseFloat(m[2]);
    }
    return isPlainNumber(s) ? parseFloat(s) : NaN;
  }

  function checkAnswer(q, input) {
    if (!input || !input.trim()) return false;
    const tol = q.tol ?? 1e-6;
    const close = (a, b) => Math.abs(a - b) <= tol + 1e-9;

    if (!Array.isArray(q.answer)) {
      // allow thousands separators like 1,234
      const cleaned = input.trim().replace(/^([+-]?\d{1,3}(,\d{3})+(\.\d+)?)$/, (s) => s.replace(/,/g, ''));
      return close(parseNumber(cleaned), q.answer);
    }

    const parts = input.replace(/[()[\]{}]/g, ' ')
      .split(/[,;]|\band\b|\bor\b/i)
      .map((s) => s.trim()).filter(Boolean)
      .map(parseNumber);
    if (!parts.length || parts.some(Number.isNaN)) return false;
    if (q.ordered) return parts.length === q.answer.length && parts.every((v, i) => close(v, q.answer[i]));

    const uniq = (arr) => arr.reduce((acc, v) => (acc.some((u) => close(u, v)) ? acc : [...acc, v]), []);
    const want = uniq(q.answer), got = uniq(parts);
    return want.length === got.length && want.every((w) => got.some((v) => close(v, w)));
  }

  window.MathQuestions = { GRADES, TOPICS, generateQuiz, checkAnswer };
})();
