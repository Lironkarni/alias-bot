(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const el = {
    loading: document.getElementById('loadingScreen'),
    error: document.getElementById('errorScreen'),
    errorText: document.getElementById('errorText'),
    game: document.getElementById('gameScreen'),
    end: document.getElementById('endScreen'),
    teamBadge: document.getElementById('teamBadge'),
    turnScore: document.getElementById('turnScore'),
    word: document.getElementById('wordText'),
    correctBtn: document.getElementById('correctBtn'),
    skipBtn: document.getElementById('skipBtn'),
    timerText: document.getElementById('timerText'),
    timerProgress: document.getElementById('timerProgress'),
    finalScore: document.getElementById('finalScore'),
  };

  const TURN_SECONDS = 60;
  const CIRC = 2 * Math.PI * 45; // 282.7
  let countdownInterval = null;

  function showOnly(panel) {
    [el.loading, el.error, el.game, el.end].forEach((p) => p.classList.add('hidden'));
    panel.classList.remove('hidden');
  }

  function showError(message) {
    el.errorText.textContent = message || 'משהו השתבש.';
    showOnly(el.error);
  }

  const initData = tg ? tg.initData : '';
  const startParam = tg && tg.initDataUnsafe ? tg.initDataUnsafe.start_param : null;

  if (!tg || !initData || !startParam) {
    showError('אי אפשר לפתוח את המסך הזה מחוץ לטלגרם.');
    return;
  }

  const socket = io();

  socket.on('connect', () => {
    socket.emit('join_turn', { initData, token: startParam });
  });

  socket.on('error_msg', (payload) => {
    showError(payload.message);
  });

  socket.on('state', (state) => {
    el.teamBadge.textContent = `קבוצה ${state.teamNumber}`;
    el.teamBadge.style.background = state.teamNumber === 1 ? '#2a5ad1' : '#c1315a';
    el.word.textContent = state.word || '…';
    el.turnScore.textContent = state.turnScore;
    showOnly(el.game);
    startCountdown(state.turnEndTime);
  });

  socket.on('word', (payload) => {
    el.word.textContent = payload.word;
    el.turnScore.textContent = payload.turnScore;
  });

  socket.on('turn_ended', (payload) => {
    clearInterval(countdownInterval);
    el.finalScore.textContent = payload.turnScore;
    setDisabled(true);
    showOnly(el.end);
  });

  el.correctBtn.addEventListener('click', () => {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    socket.emit('correct');
  });

  el.skipBtn.addEventListener('click', () => {
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
    socket.emit('skip');
  });

  function setDisabled(disabled) {
    el.correctBtn.disabled = disabled;
    el.skipBtn.disabled = disabled;
  }

  function startCountdown(turnEndTime) {
    clearInterval(countdownInterval);
    setDisabled(false);

    function tick() {
      const msLeft = turnEndTime - Date.now();
      const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
      el.timerText.textContent = secondsLeft;

      const fraction = Math.max(0, Math.min(1, msLeft / (TURN_SECONDS * 1000)));
      el.timerProgress.style.strokeDashoffset = String(CIRC * (1 - fraction));
      el.timerProgress.style.stroke = secondsLeft <= 10 ? '#ff5d73' : '#ffb703';

      if (msLeft <= 0) {
        clearInterval(countdownInterval);
        setDisabled(true);
      }
    }

    tick();
    countdownInterval = setInterval(tick, 250);
  }
})();
