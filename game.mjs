// The maze and grid movement are adapted from Dor's original sweet-pacman.
// This engine has no DOM dependencies so movement and game rules can be verified.
export const TILE = 32;
export const WIDTH = 608;
export const HEIGHT = 672;
export const DIRECTIONS = {
  left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
  up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, none: { x: 0, y: 0 }
};
export const ORIGINAL_MAZE = [
  '###################',
  '#........#........#',
  '#.###.##.#.##.###.#',
  '#o#.............#o#',
  '#.###.#.###.#.###.#',
  '#.....#..#..#.....#',
  '###.#.##...##.#.###',
  '#...#.........#...#',
  '#.###.##...##.###.#',
  '#.....#HHHHH#.....#',
  '#####.#HHHHH#.#####',
  '#.....#HHHHH#.....#',
  '#.###.###.###.###.#',
  '#........P........#',
  '#.###.#.....#.###.#',
  '#o..#.#.....#.#..o#',
  '###.#.#.###.#.#.###',
  '#.....#..#..#.....#',
  '#.######.#.######.#',
  '#.................#',
  '###################'
];
export const WORLDS = [
  { name: 'גינת התותים', subtitle: 'כל הרפתקה מתוקה מתחילה בביס קטן.',
    wall: '#cabcf4', edge: '#a792d9', ground: '#f6fcf7', pellet: '#e493a8', accent: '#81b998', fruit: '🍓' },
  { name: 'ענן של סוכר', subtitle: 'אייר, את כבר עושה כאן קסמים.',
    wall: '#a9cfdf', edge: '#81b2c9', ground: '#fcf8fd', pellet: '#d297c9', accent: '#b593d3', fruit: '🍒' },
  { name: 'מסיבת הכוכבים', subtitle: 'עוד קצת, ויש לך הפתעה קטנה.',
    wall: '#edb8c9', edge: '#d894ae', ground: '#fffdf2', pellet: '#b296d3', accent: '#d599a7', fruit: '⭐' }
];
const key = (col, row) => `${col},${row}`;
const actor = (col, row, dir = 'none') => ({ col, row, x: col + .5, y: row + .5,
  toCol: col, toRow: row, dir, next: dir, moving: false });
const opposite = (a, b) => DIRECTIONS[a].x === -DIRECTIONS[b].x && DIRECTIONS[a].y === -DIRECTIONS[b].y;

export class SweetGame {
  constructor({ mode = 'cozy', random = Math.random } = {}) {
    this.mode = mode; this.random = random; this.level = 1; this.score = 0;
    this.lives = mode === 'cozy' ? 4 : 3; this.state = 'ready';
    this.events = []; this.loadLevel();
  }
  loadLevel() {
    this.board = ORIGINAL_MAZE.map(row => row);
    if (this.level === 2) this.board.reverse();
    if (this.level === 3) {
      this.board = this.board.map(row => [...row].reverse().join(''));
      for (const [col, row] of [[9, 2], [5, 8], [13, 8], [9, 18]]) {
        this.board[row] = this.board[row].slice(0, col) + '.' + this.board[row].slice(col + 1);
      }
    }
    this.pellets = new Map(); this.elapsed = 0; this.powerUntil = 0;
    this.invulnerableUntil = 3; this.chain = 0; this.lastCollect = -10;
    this.bonusCollected = 0;
    const house = [];
    for (let row = 0; row < this.board.length; row++) {
      for (let col = 0; col < this.board[row].length; col++) {
        const c = this.board[row][col];
        if (c === 'P') this.spawn = { col, row };
        if (c === 'H') house.push({ col, row });
        if (c === '.' || c === 'o') this.pellets.set(key(col, row), { col, row, kind: c === 'o' ? 'power' : 'dot' });
      }
    }
    const fruitPlaces = [...this.pellets.values()].filter(p => p.kind === 'dot');
    for (const fraction of [.15, .51, .84]) fruitPlaces[Math.floor(fruitPlaces.length * fraction)].kind = 'fruit';
    this.total = this.pellets.size;
    this.player = actor(this.spawn.col, this.spawn.row);
    this.player.facing = 'left';
    const colors = ['#f2abc4', '#a4d2c5', '#b9a8e5', '#e6be87'];
    const count = this.mode === 'cozy' ? Math.min(3, this.level + 1) : 4;
    this.ghosts = colors.slice(0, count).map((color, index) => {
      const home = house[Math.floor(house.length / 2) + index - 1];
      return { ...actor(home.col, home.row, 'up'), home, color, index,
        releaseAt: 3.5 + index * (this.mode === 'cozy' ? 6 : 3),
        corner: [{ col: 1, row: 1 }, { col: 17, row: 19 }, { col: 17, row: 1 }, { col: 1, row: 19 }][index] };
    });
  }
  passable(col, row) { return (this.board[row]?.[col] ?? '#') !== '#'; }
  canGo(a, name) {
    const d = DIRECTIONS[name];
    return name !== 'none' && this.passable(a.col + d.x, a.row + d.y);
  }
  start() { if (this.state === 'ready' || this.state === 'paused') this.state = 'playing'; }
  pause() { if (this.state === 'playing') this.state = 'paused'; }
  direction(name) {
    if (!DIRECTIONS[name] || name === 'none' || this.state !== 'playing') return;
    this.player.next = name;
    if (this.player.moving && opposite(name, this.player.dir)) {
      const p = this.player;
      [p.col, p.toCol] = [p.toCol, p.col];
      [p.row, p.toRow] = [p.toRow, p.row];
      p.dir = name; p.facing = name;
    }
  }
  target(a, name) {
    if (!this.canGo(a, name)) return false;
    const d = DIRECTIONS[name];
    a.toCol = a.col + d.x; a.toRow = a.row + d.y;
    a.dir = name; a.moving = true;
    if (a === this.player) a.facing = name;
    return true;
  }
  move(a, amount, choose) {
    let iterations = 0;
    while (amount > .00001 && iterations++ < 8) {
      if (!a.moving && !this.target(a, choose(a))) break;
      const dx = a.toCol + .5 - a.x, dy = a.toRow + .5 - a.y;
      const distance = Math.hypot(dx, dy);
      if (amount + .00001 >= distance) {
        a.x = a.toCol + .5; a.y = a.toRow + .5;
        a.col = a.toCol; a.row = a.toRow; a.moving = false;
        amount -= distance;
        if (a === this.player) {
          this.collect();
          if (this.state !== 'playing') break;
        }
      } else {
        a.x += dx / distance * amount; a.y += dy / distance * amount; amount = 0;
      }
    }
  }
  chooseGhost(g) {
    let options = Object.keys(DIRECTIONS).filter(name => this.canGo(g, name));
    if (options.length > 1) options = options.filter(name => !opposite(name, g.dir));
    if (!options.length) return 'none';
    const scared = this.elapsed < this.powerUntil;
    const wander = this.mode === 'cozy' || Math.floor((this.elapsed + g.index * 2) / 7) % 3 === 0;
    const goal = scared || wander ? g.corner : this.player;
    options.sort((a, b) => {
      const da = DIRECTIONS[a], db = DIRECTIONS[b];
      return Math.hypot(g.col + da.x - goal.col, g.row + da.y - goal.row) -
        Math.hypot(g.col + db.x - goal.col, g.row + db.y - goal.row);
    });
    return this.random() < (wander ? .34 : .1) ? options[Math.floor(this.random() * options.length)] : options[0];
  }
  collect() {
    const p = this.pellets.get(key(this.player.col, this.player.row));
    if (!p) return;
    this.pellets.delete(key(p.col, p.row));
    this.chain = this.elapsed - this.lastCollect < 1.3 ? this.chain + 1 : 1;
    this.lastCollect = this.elapsed;
    let points = 10;
    if (p.kind === 'power') { this.powerUntil = this.elapsed + 9; points = 50; }
    if (p.kind === 'fruit') { this.bonusCollected++; points = 150; }
    this.score += points;
    this.events.push({ type: 'collect', ...p, points });
    if (this.chain === 15) this.events.push({ type: 'message', text: 'אייר, איזה רצף מתוק! ✨' });
    if (this.pellets.size === 0) {
      this.state = this.level === WORLDS.length ? 'won' : 'levelup';
      this.score += this.lives * 100;
      this.events.push({ type: this.state });
    }
  }
  collision(g) {
    if (this.elapsed < g.releaseAt || Math.hypot(this.player.x - g.x, this.player.y - g.y) > .66) return;
    if (this.elapsed < this.powerUntil) {
      this.score += 200;
      this.events.push({ type: 'hug', x: g.x, y: g.y });
      Object.assign(g, actor(g.home.col, g.home.row, 'up'));
      g.releaseAt = this.elapsed + 3;
    } else if (this.elapsed >= this.invulnerableUntil) {
      this.lives--; this.chain = 0;
      this.events.push({ type: 'hit' });
      if (!this.lives) { this.state = 'over'; this.events.push({ type: 'over' }); return; }
      this.player = actor(this.spawn.col, this.spawn.row); this.player.facing = 'left';
      this.invulnerableUntil = this.elapsed + 3;
      for (const ghost of this.ghosts) {
        Object.assign(ghost, actor(ghost.home.col, ghost.home.row, 'up'));
        ghost.releaseAt = this.elapsed + 2.5 + ghost.index * 2;
      }
    }
  }
  tick(dt) {
    if (this.state !== 'playing') return;
    dt = Math.min(.08, Math.max(0, dt)); this.elapsed += dt;
    const speed = (this.mode === 'cozy' ? 5.1 : 5.5) + (this.level - 1) * .12;
    this.move(this.player, speed * dt, p => this.canGo(p, p.next) ? p.next : p.dir);
    if (this.state !== 'playing') return;
    for (const g of this.ghosts) {
      if (this.elapsed < g.releaseAt) continue;
      const ghostSpeed = (this.mode === 'cozy' ? 2.6 : 3.65) + (this.level - 1) * .2;
      this.move(g, ghostSpeed * (this.elapsed < this.powerUntil ? .6 : 1) * dt, ghost => this.chooseGhost(ghost));
      this.collision(g);
      if (this.state !== 'playing') break;
    }
  }
  nextLevel() {
    if (this.state !== 'levelup') return;
    this.level++; this.loadLevel(); this.state = 'ready';
  }
  takeEvents() { return this.events.splice(0); }
}
