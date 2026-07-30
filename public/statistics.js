const tg = window.Telegram && window.Telegram.WebApp;
const difficultyLabels = {
  easy: 'מילים קלות',
  medium: 'מילים בינוניות',
  hard: 'מילים קשות',
};

if (tg) {
  tg.ready();
  tg.expand();
}

const loadingEl = document.getElementById('loading');
const errorEl = document.getElementById('error');
const panels = {
  summary: document.getElementById('summary'),
  successful: document.getElementById('successful'),
  skipped: document.getElementById('skipped'),
};

function showError(message) {
  loadingEl.classList.add('hidden');
  errorEl.textContent = message;
  errorEl.classList.remove('hidden');
}

function metric(value, label) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function renderSummary(summary) {
  panels.summary.innerHTML = `
    <div class="card">
      <div class="summary-grid">
        ${metric(summary.revealedWords, 'מילים שנחשפו')}
        ${metric(summary.successfulWords, 'מילים שהצלחתי')}
        ${metric(summary.skippedWords, 'מילים שדילגתי')}
        ${metric(summary.unfinishedWords, 'מילים שלא הושלמו')}
        ${metric(`${summary.wordSuccessRate}%`, 'אחוז הצלחה במילים')}
        ${metric(summary.gamesPlayed, 'משחקים ששיחקתי')}
        ${metric(summary.wins, 'ניצחונות')}
        ${metric(`${summary.winRate}%`, 'אחוז ניצחונות')}
      </div>
    </div>`;
}

function renderWordGroups(target, groups) {
  const sections = ['easy', 'medium', 'hard'].map((difficulty) => {
    const words = groups[difficulty] || [];
    const rows = words.length
      ? words.map((item) => `<div class="word-row"><span>${escapeHtml(item.word)}</span><span class="word-count">${item.count}</span></div>`).join('')
      : '<p class="empty">אין עדיין מילים ברמה הזאת.</p>';

    return `<section class="difficulty-section"><h2>${difficultyLabels[difficulty]}</h2>${rows}</section>`;
  });
  target.innerHTML = sections.join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === name);
  });
  Object.entries(panels).forEach(([panelName, panel]) => {
    panel.classList.toggle('hidden', panelName !== name);
  });
}

document.querySelectorAll('.tab').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

async function loadStatistics() {
  const initData = tg && tg.initData;
  if (!initData) {
    showError('יש לפתוח את המסך מתוך הבוט בטלגרם.');
    return;
  }

  try {
    const response = await fetch('/api/statistics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    });
    const payload = await response.json();

    if (!response.ok) {
      const messages = {
        auth_failed: 'האימות מול טלגרם נכשל. סגרו את המסך ופתחו אותו שוב.',
        personal_premium_required: 'המסך זמין למשתמשי פרימיום אישי בלבד.',
        statistics_unavailable: 'שירות הסטטיסטיקות אינו זמין כרגע.',
      };
      showError(messages[payload.error] || 'לא ניתן לטעון את הנתונים כרגע.');
      return;
    }

    renderSummary(payload.statistics.summary);
    renderWordGroups(panels.successful, payload.statistics.successfulWords);
    renderWordGroups(panels.skipped, payload.statistics.skippedWords);

    loadingEl.classList.add('hidden');
    switchTab('summary');
  } catch (error) {
    showError('לא ניתן לטעון את הנתונים כרגע.');
  }
}

loadStatistics();