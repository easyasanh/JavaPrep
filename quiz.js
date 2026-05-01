// --- Progress & Spaced Repetition ---

const Progress = {
  KEY: 'javaprep_v1',

  load() {
    try { return JSON.parse(localStorage.getItem(this.KEY)) || { questions: {} }; }
    catch { return { questions: {} }; }
  },

  save(data) {
    try { localStorage.setItem(this.KEY, JSON.stringify(data)); } catch {}
  },

  _id(q) {
    let h = 0;
    for (const c of q.q) h = (((h << 5) - h) + c.charCodeAt(0)) | 0;
    return 'q' + Math.abs(h).toString(36);
  },

  recordResult(q, isCorrect) {
    const data = this.load();
    const id = this._id(q);
    const e = data.questions[id] || { weight: 1, attempts: 0, correct: 0 };
    e.attempts += 1;
    if (isCorrect) {
      e.correct += 1;
      e.weight = Math.max(0.25, e.weight * 0.5);
    } else {
      e.weight = Math.min(4, e.weight * 2);
    }
    data.questions[id] = e;
    this.save(data);
  },

  getTopicStats(questions) {
    const stored = this.load().questions;
    const stats = {};
    for (const q of questions) {
      const e = stored[this._id(q)];
      if (!e || !e.attempts) continue;
      if (!stats[q.topic]) stats[q.topic] = { attempts: 0, correct: 0 };
      stats[q.topic].attempts += e.attempts;
      stats[q.topic].correct += e.correct;
    }
    return stats;
  },

  getMasteredCount() {
    return Object.values(this.load().questions).filter(e => e.attempts >= 2 && e.weight < 0.5).length;
  }
};

// --- Utilities ---

function shuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Weighted sampling for spaced repetition: questions answered wrong get higher weight
// and appear more frequently; correctly-answered questions fade out over time.
function weightedSample(pool, n) {
  if (pool.length <= n) return shuffle(pool);
  const stored = Progress.load().questions;
  const rem = pool.map(q => ({ q, w: stored[Progress._id(q)]?.weight ?? 1 }));
  const selected = [];
  while (selected.length < n && rem.length > 0) {
    const total = rem.reduce((s, r) => s + r.w, 0);
    let rand = Math.random() * total;
    for (let i = 0; i < rem.length; i++) {
      rand -= rem[i].w;
      if (rand <= 0) { selected.push(rem.splice(i, 1)[0].q); break; }
    }
  }
  return shuffle(selected);
}

function renderTrackGrid(targetId, cards) {
  document.getElementById(targetId).innerHTML = cards.map(card => `
    <article class="track-card">
      <div class="badge">${card.icon} Track</div>
      <h3>${card.title}</h3>
      <p>${card.description}</p>
      <ul>${card.bullets.map(b => `<li>${b}</li>`).join('')}</ul>
    </article>
  `).join('');
}

function updateHeroStats() {
  document.getElementById('masteredCount').textContent = Progress.getMasteredCount();
}

// --- Quiz Engine Factory ---

function createQuizEngine({ questions, sessionSize, ids, messages }) {
  const $ = id => document.getElementById(id);
  let selectedTopics = new Set();
  let quizQuestions = [];
  let currentIndex = 0;
  let liveScore = 0;
  let results = [];

  function getTopics() {
    return [...new Set(questions.map(q => q.topic))];
  }

  function getPool() {
    return selectedTopics.size
      ? questions.filter(q => selectedTopics.has(q.topic))
      : questions;
  }

  function showPanel(panel) {
    $(ids.setup).classList.toggle('active', panel === 'setup');
    $(ids.stage).classList.toggle('active', panel === 'stage');
    $(ids.results).classList.toggle('active', panel === 'results');
  }

  function updateSetupCounts() {
    const pool = getPool();
    const stored = Progress.load().questions;
    const due = pool.filter(q => (stored[Progress._id(q)]?.weight ?? 1) > 1).length;
    $(ids.qCount).textContent = pool.length;
    $(ids.tCount).textContent = selectedTopics.size || getTopics().length;
    $(ids.dueCount).textContent = due;
  }

  function renderChips() {
    const topicStats = Progress.getTopicStats(questions);
    $(ids.topicChips).innerHTML = getTopics().map(topic => {
      const s = topicStats[topic];
      let pctHtml = '';
      if (s && s.attempts > 0) {
        const pct = Math.round((s.correct / s.attempts) * 100);
        const cls = pct >= 80 ? 'ok' : pct >= 60 ? 'warn' : 'bad';
        pctHtml = `<span class="chip-pct ${cls}">${pct}%</span>`;
      }
      return `<button class="chip ${selectedTopics.has(topic) ? 'active' : ''}" data-topic="${topic}" aria-pressed="${selectedTopics.has(topic)}">${topic}${pctHtml}</button>`;
    }).join('');

    $(ids.topicChips).querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const { topic } = chip.dataset;
        selectedTopics.has(topic) ? selectedTopics.delete(topic) : selectedTopics.add(topic);
        renderChips();
        updateSetupCounts();
      });
    });
  }

  function start() {
    const pool = getPool();
    if (!pool.length) return;
    quizQuestions = weightedSample(pool, Math.min(sessionSize, pool.length));
    currentIndex = 0;
    liveScore = 0;
    results = [];
    $(ids.scoreLive).textContent = '0';
    showPanel('stage');
    renderQuestion();
  }

  function renderQuestion() {
    const q = quizQuestions[currentIndex];
    const total = quizQuestions.length;
    $(ids.qNum).textContent = currentIndex + 1;
    $(ids.qTotal).textContent = total;
    $(ids.topicBadge).textContent = q.topic;
    $(ids.questionText).textContent = q.q;
    $(ids.progressFill).style.width = `${(currentIndex / total) * 100}%`;

    const optionsEl = $(ids.options);
    optionsEl.setAttribute('role', 'group');
    optionsEl.setAttribute('aria-label', 'Answer choices');
    optionsEl.innerHTML = q.opts.map((opt, i) => `
      <button class="option" data-index="${i}">
        <span class="option-letter" aria-hidden="true">${String.fromCharCode(65 + i)}</span>
        <span>${opt}</span>
        <span class="option-icon" aria-hidden="true"></span>
      </button>
    `).join('');

    optionsEl.querySelectorAll('.option').forEach(btn =>
      btn.addEventListener('click', () => handleAnswer(Number(btn.dataset.index)))
    );

    $(ids.explanation).classList.remove('show');
    $(ids.explanation).innerHTML = '';
    $(ids.nextBtn).classList.remove('show');
  }

  function handleAnswer(selectedIndex) {
    const q = quizQuestions[currentIndex];
    const buttons = $(ids.options).querySelectorAll('.option');
    if (buttons[0]?.classList.contains('disabled')) return;

    buttons.forEach(btn => btn.classList.add('disabled'));
    const isCorrect = selectedIndex === q.ans;
    if (isCorrect) { liveScore += 1; $(ids.scoreLive).textContent = String(liveScore); }

    buttons.forEach((btn, i) => {
      const icon = btn.querySelector('.option-icon');
      if (i === q.ans) { btn.classList.add('correct'); icon.textContent = '✓'; }
      else if (i === selectedIndex) { btn.classList.add('wrong'); icon.textContent = '✕'; }
    });

    Progress.recordResult(q, isCorrect);
    results.push({ question: q, selectedIndex, isCorrect });
    $(ids.explanation).innerHTML = `<strong>Explanation:</strong> ${q.exp}`;
    $(ids.explanation).classList.add('show');
    $(ids.nextBtn).textContent = currentIndex + 1 < quizQuestions.length ? 'Next →' : 'See Results';
    $(ids.nextBtn).classList.add('show');
  }

  function skip() {
    const buttons = $(ids.options).querySelectorAll('.option');
    if (buttons[0]?.classList.contains('disabled')) return;
    Progress.recordResult(quizQuestions[currentIndex], false);
    results.push({ question: quizQuestions[currentIndex], selectedIndex: -1, isCorrect: false });
    advance();
  }

  function advance() {
    currentIndex += 1;
    if (currentIndex >= quizQuestions.length) showResults();
    else renderQuestion();
  }

  function showResults() {
    showPanel('results');
    const total = quizQuestions.length;
    const correct = results.filter(r => r.isCorrect).length;
    const wrong = results.filter(r => !r.isCorrect && r.selectedIndex !== -1).length;
    const skipped = results.filter(r => r.selectedIndex === -1).length;
    const percent = Math.round((correct / total) * 100);

    $(ids.resPct).textContent = `${percent}%`;
    $(ids.resCorrect).textContent = String(correct);
    $(ids.resWrong).textContent = String(wrong);
    $(ids.resSkipped).textContent = String(skipped);
    const tier = percent >= 90 ? 0 : percent >= 75 ? 1 : percent >= 60 ? 2 : 3;
    $(ids.resTitle).textContent = messages.titles[tier];
    $(ids.resSub).textContent = messages.subtitles[tier];

    $(ids.reviewList).innerHTML = results.map((r, i) => {
      const yours = r.selectedIndex === -1
        ? '<span>Skipped</span>'
        : `<span class="${r.isCorrect ? 'ok' : 'bad'}">${String.fromCharCode(65 + r.selectedIndex)}. ${r.question.opts[r.selectedIndex]}</span>`;
      const correctAns = r.isCorrect ? '' :
        `<div class="review-ans">Correct: <span class="ok">${String.fromCharCode(65 + r.question.ans)}. ${r.question.opts[r.question.ans]}</span></div>`;
      return `
        <article class="review-item">
          <div class="review-q">${i + 1}. ${r.question.q}</div>
          <div class="review-ans">Your answer: ${yours}</div>
          ${correctAns}
          <div class="review-exp">${r.question.exp}</div>
        </article>`;
    }).join('');

    updateHeroStats();
  }

  function retry() {
    if (!quizQuestions.length) return;
    quizQuestions = weightedSample(quizQuestions, quizQuestions.length);
    currentIndex = 0;
    liveScore = 0;
    results = [];
    $(ids.scoreLive).textContent = '0';
    showPanel('stage');
    renderQuestion();
  }

  return {
    start,
    advance,
    skip,
    retry,
    toSetup() { showPanel('setup'); renderChips(); updateSetupCounts(); },
    isStageActive: () => $(ids.stage).classList.contains('active'),
    selectOption: i => handleAnswer(i),
    tryAdvance() { if ($(ids.nextBtn).classList.contains('show')) advance(); },
    initSetup() { renderChips(); updateSetupCounts(); },
    refreshChips() {
      if ($(ids.setup).classList.contains('active')) { renderChips(); updateSetupCounts(); }
    }
  };
}

// --- App Initialization ---

(function init() {
  const $ = id => document.getElementById(id);

  const javaEngine = createQuizEngine({
    questions: CORE_JAVA_QUESTIONS,
    sessionSize: 12,
    ids: {
      setup: 'quizSetup', stage: 'quizStage', results: 'quizResults',
      topicChips: 'topicChips', qCount: 'setupQuestionCount',
      tCount: 'setupTopicCount', dueCount: 'setupDueCount',
      qNum: 'qNum', qTotal: 'qTotal', topicBadge: 'topicBadge',
      questionText: 'questionText', progressFill: 'progressFill',
      options: 'optionsContainer', explanation: 'explanation',
      nextBtn: 'nextBtn', scoreLive: 'scoreLive',
      resPct: 'resPct', resCorrect: 'resCorrect', resWrong: 'resWrong',
      resSkipped: 'resSkipped', resTitle: 'resTitle', resSub: 'resSub',
      reviewList: 'reviewList'
    },
    messages: {
      titles: ['Outstanding', 'Great work', 'Good progress', 'Keep going'],
      subtitles: [
        'That looks like strong first-round Java trivia coverage.',
        'Solid fundamentals — review the misses and you are in a strong spot.',
        'You have the base. Tighten the weak spots and run another round.',
        'You are building the exact Java trivia muscle this app is for.'
      ]
    }
  });

  const algoEngine = createQuizEngine({
    questions: ALGORITHM_QUESTIONS,
    sessionSize: 10,
    ids: {
      setup: 'algoQuizSetup', stage: 'algoQuizStage', results: 'algoQuizResults',
      topicChips: 'algoTopicChips', qCount: 'algoQuestionCount',
      tCount: 'algoTopicCount', dueCount: 'algoDueCount',
      qNum: 'algoQNum', qTotal: 'algoQTotal', topicBadge: 'algoTopicBadge',
      questionText: 'algoQuestionText', progressFill: 'algoProgressFill',
      options: 'algoOptionsContainer', explanation: 'algoExplanation',
      nextBtn: 'algoNextBtn', scoreLive: 'algoScoreLive',
      resPct: 'algoResPct', resCorrect: 'algoResCorrect', resWrong: 'algoResWrong',
      resSkipped: 'algoResSkipped', resTitle: 'algoResTitle', resSub: 'algoResSub',
      reviewList: 'algoReviewList'
    },
    messages: {
      titles: ['Outstanding', 'Great work', 'Good progress', 'Keep drilling'],
      subtitles: [
        'That is strong coding-round fundamentals coverage.',
        'Good algorithm instincts. Tighten the misses and rerun it.',
        'You have the base patterns — now sharpen when to reach for each one.',
        'The patterns are starting to stick — keep naming tradeoffs out loud.'
      ]
    }
  });

  // Button wiring
  $('startQuizBtn').addEventListener('click', () => javaEngine.start());
  $('nextBtn').addEventListener('click', () => javaEngine.advance());
  $('skipBtn').addEventListener('click', () => javaEngine.skip());
  $('retryQuizBtn').addEventListener('click', () => javaEngine.retry());
  $('backToSetupBtn').addEventListener('click', () => javaEngine.toSetup());

  $('startAlgoQuizBtn').addEventListener('click', () => algoEngine.start());
  $('algoNextBtn').addEventListener('click', () => algoEngine.advance());
  $('algoSkipBtn').addEventListener('click', () => algoEngine.skip());
  $('algoRetryQuizBtn').addEventListener('click', () => algoEngine.retry());
  $('algoBackToSetupBtn').addEventListener('click', () => algoEngine.toSetup());

  // Tab switching — refresh chips on return so accuracy percentages stay current
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabViews = document.querySelectorAll('.tab-view');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabButtons.forEach(t => t.classList.toggle('active', t === btn));
      tabViews.forEach(v => v.classList.toggle('active', v.id === target));
      if (target === 'core-java') javaEngine.refreshChips();
      if (target === 'algorithms') algoEngine.refreshChips();
    });
  });

  // Keyboard shortcuts: 1–4 to answer, Enter/Space to advance
  document.addEventListener('keydown', e => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const active = [javaEngine, algoEngine].find(eng => eng.isStageActive());
    if (!active) return;
    const keyMap = { '1': 0, '2': 1, '3': 2, '4': 3 };
    if (e.key in keyMap) { e.preventDefault(); active.selectOption(keyMap[e.key]); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); active.tryAdvance(); }
  });

  // Hero counts
  $('javaQuestionCount').textContent = CORE_JAVA_QUESTIONS.length;
  $('javaTopicCount').textContent = [...new Set(CORE_JAVA_QUESTIONS.map(q => q.topic))].length;
  updateHeroStats();

  renderTrackGrid('algoGuideGrid', ALGORITHM_GUIDES);
  renderTrackGrid('systemDesignGrid', SYSTEM_DESIGN_TRACKS);

  javaEngine.initSetup();
  algoEngine.initSetup();
}());
