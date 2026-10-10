import { SweetGame, TILE, WIDTH, HEIGHT, WORLDS } from './game.mjs';

const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const number = new Intl.NumberFormat('he-IL');
let mode = readSaved('ayir-mode', 'cozy');
if (!['cozy', 'classic'].includes(mode)) mode = 'cozy';
let game = new SweetGame({ mode });
let soundOn = readSaved('ayir-sound', 'off') === 'on';
let audio;
let lastFrame = 0, paintTime = 0, lastSound = 0;
let particles = [], floaters = [];
let boardCache, cacheLevel = -1, hudSnapshot = '';
let overlayAction = 'start', pendingReset = null, confirmationWasPlaying = false;
let previousState = game.state;
let boardToastTimer, toastTimer;

function readSaved(name, fallback) {
  try { return localStorage.getItem(name) ?? fallback; } catch { return fallback; }
}
function save(name, value) {
  try { localStorage.setItem(name, String(value)); } catch { /* Private browsing can disable storage. */ }
}
function bestScore() {
  const best = Number(readSaved(`ayir-best-${game.mode}`, '0'));
  return Number.isFinite(best) && best >= 0 ? best : 0;
}
function saveBest() { if (game.score > bestScore()) save(`ayir-best-${game.mode}`, game.score); }
function unlockAudio() {
  if (!soundOn) return;
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
  } catch { soundOn = false; syncSound(); }
}
function tone(frequency, length = .07, gain = .025, delay = 0) {
  if (!soundOn || !audio || audio.state !== 'running') return;
  const oscillator = audio.createOscillator(), volume = audio.createGain();
  const when = audio.currentTime + delay;
  oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, when);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * .75, when + length);
  volume.gain.setValueAtTime(.0001, when);
  volume.gain.exponentialRampToValueAtTime(gain, when + .008);
  volume.gain.exponentialRampToValueAtTime(.0001, when + length);
  oscillator.connect(volume); volume.connect(audio.destination);
  oscillator.start(when); oscillator.stop(when + length + .02);
}
function chime() { [523, 659, 784, 1047].forEach((f, i) => tone(f, .22, .035, i * .1)); }
function syncSound() {
  $('sound').setAttribute('aria-pressed', String(soundOn));
  $('sound').setAttribute('aria-label', soundOn ? 'השתקת צלילים' : 'הפעלת צלילים');
  $('sound').title = soundOn ? 'השתקת צלילים' : 'הפעלת צלילים';
}
function toast(text, board = false) {
  const el = $(board ? 'board-toast' : 'toast');
  clearTimeout(board ? boardToastTimer : toastTimer);
  el.textContent = text; el.classList.add('show');
  const timer = setTimeout(() => el.classList.remove('show'), board ? 2600 : 3200);
  if (board) boardToastTimer = timer; else toastTimer = timer;
}
function start() {
  unlockAudio(); game.start(); hideOverlay(); updateHud();
  canvas.focus({ preventScroll: true });
  if (!reducedMotion) $('board-wrap').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function reset(nextMode = mode) {
  saveBest(); mode = nextMode; save('ayir-mode', mode);
  game = new SweetGame({ mode });
  particles = []; floaters = []; cacheLevel = -1; hudSnapshot = '';
  previousState = 'ready'; $('board-toast').classList.remove('show');
  confirmationWasPlaying = false;
  clearTimeout(boardToastTimer);
  syncMode(); updateHud(); showState('ready');
}
function requestReset(nextMode) {
  if (['playing', 'paused'].includes(game.state) && (game.score || game.elapsed > 1)) {
    pendingReset = nextMode; confirmationWasPlaying = game.state === 'playing';
    game.pause(); updateHud(); $('confirm-dialog').showModal();
  } else reset(nextMode);
}
function togglePause() {
  if (game.state === 'playing') { game.pause(); showState('paused'); }
  else if (game.state === 'paused') start();
  updateHud();
}
function hideOverlay() { $('overlay').hidden = true; }
function showState(state) {
  const settings = {
    ready: ['משלוח מיוחד לאייר ♡', 'היי אייר, מוכנה לביס?', 'אספי ממתקים, תני חיבוק לרוחות,\nוגלִי מה מחכה לך בסוף.', 'יאללה, לשחק', 'בלי לחץ. רק עוד קצת מתוק.', 'start'],
    paused: ['הפסקה מתוקה ☁', 'גם לממתקים מגיע רגע.', 'קחי נשימה, אייר.\nהעולם הקטן שלך מחכה לך בדיוק כאן.', 'ממשיכים לביס הבא', 'אפשר גם ללחוץ על מקש רווח.', 'resume'],
    levelup: ['עוד עולם בכיס שלך ✨', 'אייר, את עושה כאן קסמים!', `אספת את כל הממתקים.\n${WORLDS[game.level]?.name ?? ''} כבר מחכה לך.`, 'לעולם הבא', `בונוס לבבות: +${game.lives * 100} נקודות`, 'next'],
    over: ['כל ביס הוא התחלה ♡', 'עוד סיבוב קטן?', `אספת ${number.format(game.score)} נקודות של מתיקות.\nבפעם הבאה יש עוד ממתקים לגלות.`, 'יאללה, עוד פעם', 'השיא שלך נשמר בדפדפן הזה.', 'again'],
    won: ['שלושה עולמות. חיוך אחד גדול.', 'אייר, כל המתיקות שלך!', `סיימת את כל העולמות עם ${number.format(game.score)} נקודות.\nומגיעה לך הפתעה קטנה.`, 'לפתוח את ההפתעה ♡', 'נוצר במיוחד בשבילך.', 'gift']
  };
  const item = settings[state]; if (!item) return;
  $('overlay-badge').textContent = item[0]; $('overlay-title').textContent = item[1];
  $('overlay-text').replaceChildren(...item[2].split('\n').flatMap((line, i) => i ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)]));
  $('start').replaceChildren(document.createTextNode(item[3]));
  const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '←'; $('start').append(arrow);
  $('overlay-hint').textContent = item[4]; overlayAction = item[5];
  $('overlay').hidden = false;
  if (state !== 'ready') $('start').focus({ preventScroll: true });
}
function syncMode() {
  for (const button of document.querySelectorAll('[data-mode]')) {
    const selected = button.dataset.mode === mode;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  }
  $('mode-note').textContent = mode === 'cozy' ? 'רוחות איטיות יותר, לב נוסף, בלי שעון.' : 'רוחות מהירות יותר, שלושה לבבות, בלי שעון.';
}
function updateHud() {
  saveBest();
  const best = bestScore();
  const powered = game.elapsed < game.powerUntil && game.state === 'playing';
  const remaining = powered ? Math.ceil(game.powerUntil - game.elapsed) : 0;
  const snapshot = [game.score, best, game.level, game.lives, game.pellets.size, game.state, remaining].join('|');
  if (snapshot === hudSnapshot) return; hudSnapshot = snapshot;
  $('score').textContent = number.format(game.score); $('best').textContent = number.format(best);
  $('level').textContent = game.level; $('world-name').textContent = WORLDS[game.level - 1].name;
  const capacity = game.mode === 'cozy' ? 4 : 3;
  $('lives').replaceChildren();
  for (let i = 0; i < capacity; i++) {
    const heart = document.createElement('span'); heart.textContent = '♥'; heart.setAttribute('aria-hidden', 'true');
    if (i >= game.lives) heart.className = 'empty';
    $('lives').append(heart, document.createTextNode(' '));
  }
  $('lives').setAttribute('aria-label', `${game.lives} לבבות מתוך ${capacity}`);
  const collected = game.total - game.pellets.size, percent = Math.round(collected / game.total * 100);
  $('progress-text').textContent = `${collected} מתוך ${game.total}`;
  $('progress-fill').style.width = `${percent}%`; $('progress').setAttribute('aria-valuenow', String(percent));
  for (const world of document.querySelectorAll('[data-world]')) {
    const level = Number(world.dataset.world);
    world.classList.toggle('active', level === game.level); world.classList.toggle('done', level < game.level || game.state === 'won');
    const label = world.querySelector('.world-number');
    label.textContent = level < game.level || game.state === 'won' ? '✓' : `0${level}`;
    if (level === game.level) world.setAttribute('aria-current', 'step'); else world.removeAttribute('aria-current');
  }
  $('pause').disabled = !['playing', 'paused'].includes(game.state);
  $('pause-label').textContent = game.state === 'paused' ? 'ממשיכים' : 'רגע קטן';
  $('pause-icon').textContent = game.state === 'paused' ? '▷' : 'Ⅱ';
  $('power-banner').hidden = !powered; $('power-time').textContent = remaining;
}

function round(c, x, y, w, h, radius, fill, stroke) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, w, h, radius); else c.rect(x, y, w, h);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.stroke(); }
}
function heart(c, x, y, size, color) {
  c.save(); c.translate(x, y); c.scale(size / 20, size / 20);
  c.beginPath(); c.moveTo(0, 7); c.bezierCurveTo(-21, -5, -8, -17, 0, -8);
  c.bezierCurveTo(8, -17, 21, -5, 0, 7); c.fillStyle = color; c.fill(); c.restore();
}
function star(c, x, y, radius, color) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = i * Math.PI / 5 - Math.PI / 2, r = i % 2 ? radius * .45 : radius;
    const xx = x + Math.cos(angle) * r, yy = y + Math.sin(angle) * r;
    if (!i) c.moveTo(xx, yy); else c.lineTo(xx, yy);
  }
  c.closePath(); c.fillStyle = color; c.fill();
}
function makeBoard() {
  boardCache = document.createElement('canvas'); boardCache.width = WIDTH; boardCache.height = HEIGHT;
  const c = boardCache.getContext('2d'), world = WORLDS[game.level - 1];
  c.fillStyle = world.ground; c.fillRect(0, 0, WIDTH, HEIGHT);
  c.fillStyle = '#87b79a12';
  for (let y = 16; y < HEIGHT; y += 16) for (let x = 16; x < WIDTH; x += 16) c.fillRect(x, y, 1, 1);
  c.lineWidth = 1.2;
  for (let row = 0; row < game.board.length; row++) {
    for (let col = 0; col < game.board[row].length; col++) {
      if (game.board[row][col] !== '#') continue;
      const x = col * TILE, y = row * TILE;
      round(c, x + 2, y + 3, 28, 28, 7, world.edge + '50');
      round(c, x + 2, y + 1, 28, 28, 7, world.wall, world.edge + '90');
      c.fillStyle = world.wall;
      if (game.board[row][col + 1] === '#') c.fillRect(x + 22, y + 1, 20, 28);
      if (game.board[row + 1]?.[col] === '#') c.fillRect(x + 2, y + 22, 28, 18);
    }
  }
  const houseCells = [];
  for (let row = 0; row < game.board.length; row++) {
    for (let col = 0; col < game.board[row].length; col++) if (game.board[row][col] === 'H') houseCells.push({ col, row });
  }
  const minX = Math.min(...houseCells.map(p => p.col)) * TILE, minY = Math.min(...houseCells.map(p => p.row)) * TILE;
  round(c, minX + 6, minY + 5, 5 * TILE - 12, 3 * TILE - 10, 15, '#eadfec70');
  c.textAlign = 'center'; c.fillStyle = '#b19abc'; c.font = '9px Arial';
  c.fillText('THE CUDDLE CLUB', minX + 2.5 * TILE, minY + 20);
  heart(c, minX + 2.5 * TILE, minY + 76, 10, '#d9b4c9');
  cacheLevel = game.level;
}
function drawPlayer() {
  const p = game.player, x = p.x * TILE, y = p.y * TILE;
  ctx.save(); ctx.translate(x, y);
  if (!reducedMotion && game.state === 'playing' && game.elapsed < game.invulnerableUntil) ctx.globalAlpha = .68 + Math.sin(paintTime * .013) * .22;
  if (game.elapsed < game.powerUntil) {
    ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fillStyle = '#e8b0d733'; ctx.fill();
    ctx.strokeStyle = '#d39ac888'; ctx.lineWidth = 1; ctx.stroke();
  }
  const facing = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[p.facing];
  const mouth = p.moving && game.state === 'playing' && !reducedMotion ? .16 + .28 * (.5 + .5 * Math.sin(paintTime * .021)) : .23;
  ctx.save(); ctx.rotate(facing);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 13, mouth * Math.PI, (2 - mouth) * Math.PI); ctx.closePath();
  ctx.fillStyle = '#ffdb7d'; ctx.fill(); ctx.strokeStyle = '#dba953'; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-3, 4, 4, 2.5, 0, 0, 2 * Math.PI); ctx.fillStyle = '#eca5b4'; ctx.fill();
  ctx.beginPath(); ctx.ellipse(2, -6.5, 1.8, 2.5, 0, 0, 2 * Math.PI); ctx.fillStyle = '#645071'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(2.5, -9); ctx.lineTo(3.5, -11); ctx.strokeStyle = '#645071'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
  ctx.beginPath(); ctx.moveTo(-5, -13); ctx.lineTo(-14, -19); ctx.quadraticCurveTo(-15, -8, -5, -10);
  ctx.lineTo(3, -19); ctx.quadraticCurveTo(7, -8, -5, -10); ctx.fillStyle = '#e8a2bd'; ctx.fill(); ctx.strokeStyle = '#be7c9b'; ctx.lineWidth = .8; ctx.stroke();
  ctx.beginPath(); ctx.arc(-5, -12, 2.7, 0, Math.PI * 2); ctx.fillStyle = '#f8cfdd'; ctx.fill(); ctx.stroke();
  ctx.restore();
}
function drawGhost(g) {
  const scared = game.elapsed < game.powerUntil && game.elapsed >= g.releaseAt;
  const bob = reducedMotion ? 0 : Math.sin(paintTime * .004 + g.index * 2) * 1.3;
  ctx.save(); ctx.translate(g.x * TILE, g.y * TILE + bob);
  const fill = scared ? '#dbb5dc' : g.color;
  ctx.beginPath(); ctx.moveTo(-12, 11); ctx.lineTo(-12, -1); ctx.bezierCurveTo(-12, -18, 12, -18, 12, -1);
  ctx.lineTo(12, 11); ctx.quadraticCurveTo(8, 4, 4, 11); ctx.quadraticCurveTo(0, 4, -4, 11);
  ctx.quadraticCurveTo(-8, 4, -12, 11); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#8f719f60'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-8, 3, 2.6, 1.5, 0, 0, 2 * Math.PI); ctx.ellipse(8, 3, 2.6, 1.5, 0, 0, 2 * Math.PI); ctx.fillStyle = '#ec92ac88'; ctx.fill();
  if (scared) { heart(ctx, -4.5, -3, 4.5, '#92658d'); heart(ctx, 4.5, -3, 4.5, '#92658d'); }
  else {
    ctx.fillStyle = '#fffdf6'; ctx.beginPath(); ctx.ellipse(-4, -3, 3.6, 4.3, 0, 0, 2 * Math.PI); ctx.ellipse(4, -3, 3.6, 4.3, 0, 0, 2 * Math.PI); ctx.fill();
    const offset = { left: [-1.1, 0], right: [1.1, 0], up: [0, -1.1], down: [0, 1.1], none: [0, 0] }[g.dir];
    ctx.fillStyle = '#645071'; ctx.beginPath(); ctx.arc(-4 + offset[0], -3 + offset[1], 1.7, 0, 2 * Math.PI); ctx.arc(4 + offset[0], -3 + offset[1], 1.7, 0, 2 * Math.PI); ctx.fill();
  }
  ctx.beginPath(); ctx.arc(0, 3.3, 2.5, .15, Math.PI - .15); ctx.strokeStyle = '#826181'; ctx.lineWidth = .85; ctx.stroke(); ctx.restore();
}
function sprinkle(x, y, color, amount = 8) {
  if (reducedMotion) return;
  for (let i = 0; i < amount && particles.length < 110; i++) {
    const angle = Math.random() * Math.PI * 2, speed = 12 + Math.random() * 40;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 12, color, life: .5 + Math.random() * .3, max: .8, size: 1.5 + Math.random() * 2.5 });
  }
}
function celebration() {
  if (reducedMotion) return;
  for (let i = 0; i < 80; i++) particles.push({ x: Math.random() * WIDTH, y: Math.random() * HEIGHT / 2, vx: (Math.random() - .5) * 80, vy: 40 + Math.random() * 100, life: 2, max: 2, size: 3 + Math.random() * 4, color: ['#c1a5e6', '#e8a2bd', '#a2c6b0', '#f5ce79'][i % 4] });
}
function draw(dt) {
  if (!ctx) return;
  if (cacheLevel !== game.level) makeBoard();
  ctx.clearRect(0, 0, WIDTH, HEIGHT); ctx.drawImage(boardCache, 0, 0);
  const world = WORLDS[game.level - 1];
  for (const pellet of game.pellets.values()) {
    const x = (pellet.col + .5) * TILE, y = (pellet.row + .5) * TILE;
    if (pellet.kind === 'dot') {
      ctx.beginPath(); ctx.arc(x, y, 3.1, 0, Math.PI * 2); ctx.fillStyle = world.pellet; ctx.fill();
      ctx.beginPath(); ctx.arc(x - .8, y - .8, .8, 0, Math.PI * 2); ctx.fillStyle = '#fff5f5'; ctx.fill();
    } else if (pellet.kind === 'power') {
      const size = 13 + (reducedMotion ? 0 : Math.sin(paintTime * .004) * 1.1);
      ctx.beginPath(); ctx.arc(x, y - 2, 12, 0, Math.PI * 2); ctx.fillStyle = '#efb8d02b'; ctx.fill();
      heart(ctx, x, y, size, '#d892ae');
    } else {
      ctx.font = '21px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(world.fruit, x, y + .5);
    }
  }
  for (const ghost of game.ghosts) drawGhost(ghost);
  drawPlayer();
  for (const p of particles) {
    p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 45 * dt;
    ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color;
    round(ctx, p.x, p.y, p.size, p.size * .65, 1, p.color);
  }
  ctx.globalAlpha = 1; particles = particles.filter(p => p.life > 0);
  ctx.font = 'bold 15px Arial'; ctx.textAlign = 'center';
  for (const f of floaters) {
    f.life -= dt; f.y -= 23 * dt; ctx.globalAlpha = Math.max(0, f.life);
    ctx.fillStyle = '#9b718c'; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1; floaters = floaters.filter(f => f.life > 0);
}
function handleEvents() {
  for (const event of game.takeEvents()) {
    if (event.type === 'collect') {
      if (event.kind !== 'dot') {
        sprinkle((event.col + .5) * TILE, (event.row + .5) * TILE, '#d59ab8', 18);
        floaters.push({ x: (event.col + .5) * TILE, y: (event.row + .5) * TILE - 12, text: `+${event.points}`, life: 1.1 });
        if (event.kind === 'power') { tone(660, .15, .035); tone(880, .16, .025, .13); toast('לב גדול! עכשיו אפשר לחבק את הרוחות ♡', true); }
        else { tone(1047, .12, .03); toast('ביס בונוס! +150 נקודות 🍓', true); }
      } else {
        sprinkle((event.col + .5) * TILE, (event.row + .5) * TILE, '#dbb3ce', 3);
        if (paintTime - lastSound > 100) { tone(game.chain % 2 ? 730 : 860, .045, .014); lastSound = paintTime; }
      }
    } else if (event.type === 'hug') {
      sprinkle(event.x * TILE, event.y * TILE, '#c89ace', 18);
      floaters.push({ x: event.x * TILE, y: event.y * TILE - 12, text: '♡ +200', life: 1.2 });
      tone(960, .15, .03);
    } else if (event.type === 'hit') {
      document.querySelector('.game-card').classList.remove('flash');
      requestAnimationFrame(() => document.querySelector('.game-card').classList.add('flash'));
      tone(280, .17, .025); toast('אופס, חיבוק מוקדם. יש עוד מתיקות לאסוף ♡', true);
    } else if (event.type === 'message') toast(event.text, true);
    else if (['levelup', 'won'].includes(event.type)) { celebration(); chime(); }
  }
}
function frame(now) {
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .08) : 0;
  lastFrame = now; paintTime = now;
  game.tick(dt); handleEvents(); updateHud(); draw(dt);
  if (game.state !== previousState) {
    previousState = game.state;
    if (game.state !== 'playing') showState(game.state);
  }
  requestAnimationFrame(frame);
}
function resizeCanvas() {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(WIDTH * ratio); canvas.height = Math.round(HEIGHT * ratio);
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
}

$('start').addEventListener('click', () => {
  if (overlayAction === 'next') { game.nextLevel(); previousState = 'ready'; cacheLevel = -1; start(); toast(WORLDS[game.level - 1].subtitle, true); }
  else if (overlayAction === 'again') { reset(); start(); }
  else if (overlayAction === 'gift') $('gift-dialog').showModal();
  else start();
});
$('pause').addEventListener('click', togglePause);
$('restart').addEventListener('click', () => requestReset(mode));
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => {
  if (button.dataset.mode !== mode) requestReset(button.dataset.mode);
});
$('confirm-yes').addEventListener('click', () => { $('confirm-dialog').close(); reset(pendingReset ?? mode); pendingReset = null; });
function cancelReset() {
  $('confirm-dialog').close(); pendingReset = null;
  if (confirmationWasPlaying) start(); else showState(game.state);
  confirmationWasPlaying = false;
}
$('confirm-no').addEventListener('click', cancelReset);
$('confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelReset(); });
$('gift-close').addEventListener('click', () => { $('gift-dialog').close(); reset(); start(); });
$('sound').addEventListener('click', () => {
  soundOn = !soundOn; syncSound(); save('ayir-sound', soundOn ? 'on' : 'off');
  if (soundOn) { unlockAudio(); tone(784, .16, .035); }
});
$('share').addEventListener('click', async () => {
  const details = { title: 'iiar / אייר · ביס קטן של אושר', text: 'אייר, עולם קטן ומתוק שנוצר במיוחד בשבילך ♡', url: location.href };
  try {
    if (navigator.share) await navigator.share(details);
    else { await navigator.clipboard.writeText(details.url); toast('הקישור הועתק. עכשיו אפשר לשלוח חיוך ♡'); }
  } catch (error) {
    if (error.name !== 'AbortError') toast('הקישור נמצא בשורת הכתובת ואפשר להעתיק אותו משם.');
  }
});
const keyDirections = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
document.addEventListener('keydown', event => {
  if ($('confirm-dialog').open || $('gift-dialog').open || event.ctrlKey || event.metaKey || event.altKey) return;
  const focusedButton = document.activeElement?.tagName === 'BUTTON';
  if (event.code === 'Space' && !focusedButton && ['playing', 'paused'].includes(game.state)) { event.preventDefault(); if (!event.repeat) togglePause(); return; }
  if (event.code === 'Escape') { if (game.state === 'playing') togglePause(); return; }
  const direction = keyDirections[event.code];
  if (direction && game.state === 'playing') { event.preventDefault(); game.direction(direction); }
});
for (const button of document.querySelectorAll('[data-dir]')) {
  const direct = event => {
    event.preventDefault();
    if (game.state === 'playing') { game.direction(button.dataset.dir); $('start').blur(); }
  };
  button.addEventListener('pointerdown', direct);
  button.addEventListener('click', () => game.direction(button.dataset.dir));
}
let swipe = null;
canvas.addEventListener('pointerdown', event => {
  if (game.state !== 'playing') return;
  swipe = { x: event.clientX, y: event.clientY, id: event.pointerId };
  canvas.setPointerCapture(event.pointerId);
});
function handleSwipe(event) {
  if (!swipe || swipe.id !== event.pointerId || game.state !== 'playing') return;
  const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
  if (Math.hypot(dx, dy) < 14) return;
  game.direction(Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up');
  swipe.x = event.clientX; swipe.y = event.clientY;
}
canvas.addEventListener('pointermove', handleSwipe);
canvas.addEventListener('pointerup', event => { handleSwipe(event); swipe = null; });
canvas.addEventListener('pointercancel', () => { swipe = null; });
canvas.addEventListener('lostpointercapture', () => { swipe = null; });
function autoPause() { if (game.state === 'playing') { game.pause(); showState('paused'); updateHud(); } }
document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
window.addEventListener('blur', autoPause);
window.addEventListener('resize', resizeCanvas);
syncSound(); syncMode(); updateHud(); resizeCanvas();
if (!ctx) {
  $('overlay-title').textContent = 'צריך דפדפן קצת יותר חדש';
  $('overlay-text').textContent = 'פתחי את הקישור ב־Safari, Chrome או Firefox כדי לשחק.';
  $('start').disabled = true;
} else requestAnimationFrame(frame);
