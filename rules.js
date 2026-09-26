// Чистая логика игры «Двойники».
// Никакого DOM, сети и таймеров: модуль одинаково работает в браузере и в Node.
// Все функции возвращают новые объекты и не меняют входные.

export const SIZE = 5;
export const PIECES = 3;
export const MAX_ROUNDS = 10;
export const FIRE_FROM_ROUND = 7;
export const ROUND_SECONDS = 30;
export const PLAYERS = ['host', 'guest'];

// Абсолютные координаты: r = 0 верхний ряд (сторона гостя), r = 4 нижний (сторона хоста).
// Направления тоже абсолютные: 'up' уменьшает r. UI гостя поворачивает поле на 180°
// и переводит направления сам.
export const DIRS = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
};

// Старт: «колонки 1–3» от лица каждого игрока. Гость смотрит на повёрнутое поле,
// поэтому в абсолютных координатах его фишки стоят в колонках 3–5 (точечная симметрия).
export const START = {
  host: [0, 1, 2].map((i) => ({ r: SIZE - 1, c: i })),
  guest: [0, 1, 2].map((i) => ({ r: 0, c: SIZE - 1 - i })),
};

// Перегородки (укрытия) стоят на границе между соседними клетками: через них нельзя
// шагнуть, и пуля в них упирается. Отрезок перегородки { r, c, side }:
//   side 'h' — между (r,c) и (r+1,c) (горизонтальная линия под клеткой),
//   side 'v' — между (r,c) и (r,c+1) (вертикальная линия справа от клетки).
// Раскладку на партию выбирает судья (случайность живёт вне rules.js) из этого набора.
// В раскладке 2 перегородки по 2 клетки длиной; раскладки точечно-симметричны, как и старт.
const h = (r, c) => ({ r, c, side: 'h' });
const v = (r, c) => ({ r, c, side: 'v' });
export const WALL_LAYOUTS = [
  [h(1, 1), h(1, 2), h(2, 2), h(2, 3)],
  [v(1, 1), v(2, 1), v(2, 2), v(3, 2)],
  [h(1, 0), h(1, 1), h(2, 3), h(2, 4)],
  [v(1, 2), v(2, 2), v(2, 1), v(3, 1)],
];

// Есть ли перегородка на пути из клетки (r,c) в соседнюю по направлению dir.
export function crossesWall(walls, r, c, dir) {
  const edge = dir === 'down' ? h(r, c) : dir === 'up' ? h(r - 1, c) : dir === 'right' ? v(r, c) : v(r, c - 1);
  return (walls || []).find((w) => w.r === edge.r && w.c === edge.c && w.side === edge.side) || null;
}

export function other(player) {
  return player === 'host' ? 'guest' : 'host';
}

export function pieceId(owner, index) {
  return (owner === 'host' ? 'h' : 'g') + index;
}

export function isEdge(r, c) {
  return r === 0 || c === 0 || r === SIZE - 1 || c === SIZE - 1;
}

export function inBounds(r, c) {
  return r >= 0 && c >= 0 && r < SIZE && c < SIZE;
}

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// Новая партия. cores необязательны: ядро соперника судья может и не знать (сетевой режим).
// walls — перегородки [{r,c,side}], по умолчанию поле без перегородок.
export function createGame({ hostCore = null, guestCore = null, walls = [] } = {}) {
  const pieces = [];
  for (const owner of PLAYERS) {
    START[owner].forEach((pos, index) => {
      pieces.push({ id: pieceId(owner, index), owner, index, r: pos.r, c: pos.c, alive: true });
    });
  }
  return {
    round: 1,
    phase: 'planning', // planning | reveal | over
    pieces,
    walls: walls.map((w) => ({ r: w.r, c: w.c, side: w.side })),
    scanUsed: { host: false, guest: false },
    swapUsed: { host: false, guest: false },
    // Публичный факт подмены ядра: { round, hash } — раунд и отпечаток цели, сама цель тайна до конца партии.
    swaps: { host: null, guest: null },
    reveals: {}, // публичные раскрытия уничтоженных: pieceId -> 'core' | 'dummy'
    revealRound: {}, // pieceId -> раунд раскрытия (нужен для проверки ответов с учётом подмены)
    pendingReveals: [], // уничтоженные фишки, ждущие ответа владельца
    pendingScans: [], // [{ by, targetId }] — сканы, ждущие ответа владельца цели (оба могут сканировать в одном раунде)
    lastEvents: [],
    result: null, // { winner: 'host' | 'guest' | null, reason }
    private: {
      host: { core: hostCore, scans: [] },
      guest: { core: guestCore, scans: [] },
    },
  };
}

export function emptyOrders() {
  return { moves: [null, null, null], action: null };
}

// Приводит приказы к допустимому виду. Всё недопустимое превращается в «стоять» / «нет действия».
// null или undefined (игрок не успел до дедлайна) → все стоят, действия нет (правило 8).
export function normalizeOrders(state, player, orders) {
  const out = emptyOrders();
  if (!orders || typeof orders !== 'object') return out;
  const mine = state.pieces.filter((p) => p.owner === player);
  if (Array.isArray(orders.moves)) {
    for (let i = 0; i < PIECES; i++) {
      const dir = orders.moves[i];
      const piece = mine[i];
      if (piece && piece.alive && Object.hasOwn(DIRS, dir)) out.moves[i] = dir;
    }
  }
  const a = orders.action;
  if (a && a.type === 'shot') {
    const piece = mine[a.piece];
    if (Number.isInteger(a.piece) && piece && piece.alive && Object.hasOwn(DIRS, a.dir)) {
      out.action = { type: 'shot', piece: a.piece, dir: a.dir };
    }
  } else if (a && a.type === 'scan') {
    const target = state.pieces.find((p) => p.owner === other(player) && p.index === a.target);
    if (Number.isInteger(a.target) && target && target.alive && !state.scanUsed[player]) {
      out.action = { type: 'scan', target: a.target };
    }
  } else if (a && a.type === 'swap') {
    // Подмена ядра: в приказах только отпечаток новой цели. На живую ли фишку она,
    // судья проверить не может — это ловит финальная проверка (checkSwap).
    const aliveCount = mine.filter((p) => p.alive).length;
    if (typeof a.hash === 'string' && /^[0-9a-f]{64}$/.test(a.hash) && !state.swapUsed?.[player] && aliveCount >= 2) {
      out.action = { type: 'swap', hash: a.hash };
    }
  }
  return out;
}

// Разрешение движений (правило 4). pieces: живые фишки { id, r, c }, dirs: id -> направление | null.
// walls — перегородки: шаг через перегородку = «стоять» и не считается претензией на клетку.
// Возвращает { positions: id -> {r,c}, moves: [{ id, from, to, ok, reason }] }.
export function resolveMoves(pieces, dirs, walls = []) {
  const key = (r, c) => r * SIZE + c;
  const target = new Map();
  const reason = new Map(); // id -> причина блокировки
  for (const p of pieces) {
    const d = DIRS[dirs[p.id]];
    const tr = d ? p.r + d.dr : p.r;
    const tc = d ? p.c + d.dc : p.c;
    // Шаг за край поля или через перегородку считается «стоять».
    const blocked = !inBounds(tr, tc) ? 'edge' : d && crossesWall(walls, p.r, p.c, dirs[p.id]) ? 'wall' : null;
    target.set(p.id, blocked ? { r: p.r, c: p.c } : { r: tr, c: tc });
    if (d && blocked) reason.set(p.id, blocked);
  }
  const wantsMove = (p) => {
    const t = target.get(p.id);
    return t.r !== p.r || t.c !== p.c;
  };
  const moving = (p) => wantsMove(p) && !reason.has(p.id);

  // Две фишки претендуют на одну клетку → обе остаются.
  const claims = new Map();
  for (const p of pieces.filter(wantsMove)) {
    const k = key(target.get(p.id).r, target.get(p.id).c);
    claims.set(k, (claims.get(k) || []).concat(p.id));
  }
  for (const ids of claims.values()) if (ids.length > 1) ids.forEach((id) => reason.set(id, 'contest'));

  const occupant = new Map(pieces.map((p) => [key(p.r, p.c), p]));

  // Повторяем, пока позиции не стабилизируются.
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of pieces) {
      if (!moving(p)) continue;
      const t = target.get(p.id);
      const occ = occupant.get(key(t.r, t.c));
      if (!occ) continue;
      if (!moving(occ)) {
        // Фишка в целевой клетке не уходит.
        reason.set(p.id, 'occupied');
        changed = true;
      } else {
        const ot = target.get(occ.id);
        if (ot.r === p.r && ot.c === p.c) {
          // Обмен местами → обе остаются.
          reason.set(p.id, 'swap');
          reason.set(occ.id, 'swap');
          changed = true;
        }
      }
    }
    if (changed) continue;
    // Кольцо из 3+ фишек, идущих друг за другом, блокируется так же, как обмен.
    for (const p of pieces) {
      if (!moving(p)) continue;
      const chain = [p];
      let cur = p;
      for (;;) {
        const t = target.get(cur.id);
        const occ = occupant.get(key(t.r, t.c));
        if (!occ || !moving(occ)) break;
        if (occ === p) {
          chain.forEach((q) => reason.set(q.id, 'cycle'));
          changed = true;
          break;
        }
        if (chain.includes(occ)) break;
        chain.push(occ);
        cur = occ;
      }
      if (changed) break;
    }
  }

  const positions = {};
  const moves = [];
  for (const p of pieces) {
    const ok = moving(p);
    const to = ok ? target.get(p.id) : { r: p.r, c: p.c };
    positions[p.id] = { r: to.r, c: to.c };
    if (dirs[p.id]) {
      moves.push({
        type: 'move',
        id: p.id,
        dir: dirs[p.id],
        from: { r: p.r, c: p.c },
        to: { ...to },
        ok,
        reason: ok ? null : reason.get(p.id) || 'blocked',
      });
    }
  }
  return { positions, moves };
}

// Трассировка выстрела: от позиции стрелка по прямой до первой фишки (любой, кроме самого стрелка).
// Перегородка останавливает пулю: end — последняя клетка перед ней, wall — сам отрезок.
export function traceShot(pieces, shooter, dir, walls = []) {
  const d = DIRS[dir];
  let r = shooter.r + d.dr;
  let c = shooter.c + d.dc;
  let last = { r: shooter.r, c: shooter.c };
  while (inBounds(r, c)) {
    const wall = crossesWall(walls, last.r, last.c, dir);
    if (wall) return { hitId: null, end: last, wall: { ...wall } };
    const hit = pieces.find((p) => p.r === r && p.c === c && p.id !== shooter.id);
    if (hit) return { hitId: hit.id, end: { r, c }, wall: null };
    last = { r, c };
    r += d.dr;
    c += d.dc;
  }
  return { hitId: null, end: last, wall: null };
}

// Разрешение раунда: движения → выстрелы → горящее кольцо.
// ordersByPlayer: { host, guest }, любой может быть null (дедлайн, правило 8).
// Возвращает { state, events }. Уничтоженные фишки попадают в pendingReveals:
// их владелец должен ответить «ядро/пустышка» через applyReveals.
export function resolveRound(state, ordersByPlayer) {
  if (state.phase !== 'planning') throw new Error('resolveRound: раунд не в фазе планирования');
  const s = clone(state);
  const orders = {
    host: normalizeOrders(s, 'host', ordersByPlayer?.host),
    guest: normalizeOrders(s, 'guest', ordersByPlayer?.guest),
  };
  const events = [];
  const alive = s.pieces.filter((p) => p.alive);
  s.swapUsed ||= { host: false, guest: false };
  s.swaps ||= { host: null, guest: null };
  s.revealRound ||= {};
  s.pendingScans = [];

  // 0. Подмена ядра срабатывает в начале раунда, до движения: всё в этом раунде — уже про новое ядро.
  for (const player of PLAYERS) {
    const a = orders[player].action;
    if (a?.type !== 'swap') continue;
    s.swapUsed[player] = true;
    s.swaps[player] = { round: s.round, hash: a.hash };
    events.push({ type: 'swap', by: player, round: s.round });
  }

  // 1. Движения, все одновременно.
  const dirs = {};
  for (const p of alive) dirs[p.id] = orders[p.owner].moves[p.index];
  const walls = s.walls || [];
  const { positions, moves } = resolveMoves(alive, dirs, walls);
  events.push(...moves);
  for (const p of alive) Object.assign(p, positions[p.id]);

  // 2. Действия. Все выстрелы считаются по позициям после движения, одновременно:
  // фишка, сбитая в этом раунде, свой выстрел всё равно делает.
  const hit = new Set();
  for (const player of PLAYERS) {
    const a = orders[player].action;
    if (!a) continue;
    if (a.type === 'shot') {
      const shooter = alive.find((p) => p.owner === player && p.index === a.piece);
      const { hitId, end, wall } = traceShot(alive, shooter, a.dir, walls);
      events.push({ type: 'shot', by: player, id: shooter.id, dir: a.dir, from: { r: shooter.r, c: shooter.c }, end, hitId, wall });
      if (hitId) hit.add(hitId);
    } else if (a.type === 'scan') {
      const target = s.pieces.find((p) => p.owner === other(player) && p.index === a.target);
      s.scanUsed[player] = true;
      s.pendingScans.push({ by: player, targetId: target.id });
      events.push({ type: 'scan', by: player, targetId: target.id });
    }
  }
  for (const id of hit) events.push({ type: 'destroyed', id, cause: 'shot' });

  // 3. С 7-го раунда горит внешнее кольцо: после выстрелов сгорают все фишки на краю.
  if (s.round >= FIRE_FROM_ROUND) {
    for (const p of alive) {
      if (!hit.has(p.id) && isEdge(p.r, p.c)) {
        hit.add(p.id);
        events.push({ type: 'destroyed', id: p.id, cause: 'fire' });
      }
    }
  }

  for (const p of alive) if (hit.has(p.id)) p.alive = false;
  s.pendingReveals = [...hit];
  s.lastEvents = events;
  s.phase = 'reveal';
  // Если раскрывать нечего, раунд завершается сразу.
  const done = s.pendingReveals.length === 0 && !s.pendingScans.length ? finishRound(s) : s;
  return { state: done, events };
}

// Честный ответ владельца на уничтожение или скан своей фишки.
export function answerFor(coreIndex, piece) {
  return piece.index === coreIndex ? 'core' : 'dummy';
}

// Ответы владельцев на уничтожение: answers { pieceId: 'core' | 'dummy' }.
// Применяется, когда получены ответы на ВСЕ pendingReveals; скан закрывается отдельно (applyScanAnswer).
export function applyReveals(state, answers) {
  if (state.phase !== 'reveal') throw new Error('applyReveals: нечего раскрывать');
  const s = clone(state);
  for (const id of s.pendingReveals) {
    const a = answers?.[id];
    if (a !== 'core' && a !== 'dummy') throw new Error('applyReveals: нет ответа для ' + id);
    s.reveals[id] = a;
    (s.revealRound ||= {})[id] = s.round;
    s.lastEvents.push({ type: 'reveal', id, answer: a });
  }
  s.pendingReveals = [];
  return s.pendingScans?.length ? s : finishRound(s);
}

// Ответ владельца цели на скан игрока by (по умолчанию — первый ждущий скан).
// Попадает только в приватную часть сканирующего.
export function applyScanAnswer(state, answer, by = state.pendingScans?.[0]?.by) {
  const i = (state.pendingScans || []).findIndex((x) => x.by === by);
  if (i < 0) throw new Error('applyScanAnswer: скана нет');
  if (answer !== 'core' && answer !== 'dummy') throw new Error('applyScanAnswer: неверный ответ');
  const s = clone(state);
  const { targetId } = s.pendingScans[i];
  s.private[by].scans.push({ targetId, answer, round: s.round });
  s.pendingScans.splice(i, 1);
  return s.pendingReveals.length || s.pendingScans.length ? s : finishRound(s);
}

// Итог раунда: уничтожено ядро → поражение, оба ядра в одном раунде → ничья,
// конец 10-го раунда → ничья.
function finishRound(s) {
  const lost = PLAYERS.filter((pl) =>
    s.pieces.some((p) => p.owner === pl && s.reveals[p.id] === 'core'),
  );
  if (lost.length === 2) s.result = { winner: null, reason: 'both-cores' };
  else if (lost.length === 1) s.result = { winner: other(lost[0]), reason: 'core' };
  else if (s.round >= MAX_ROUNDS) s.result = { winner: null, reason: 'rounds' };
  if (s.result) {
    s.phase = 'over';
  } else {
    s.phase = 'planning';
    s.round += 1;
  }
  return s;
}

// Уход из игры засчитывается как поражение (решает сетевой слой).
export function forfeit(state, loser) {
  const s = clone(state);
  s.result = { winner: other(loser), reason: 'forfeit' };
  s.phase = 'over';
  return s;
}

// Ядро, действующее в раунде round: до раунда подмены — исходное, начиная с него — новое.
// swap: null | { core, round } (раскрывается владельцем в конце партии).
// round = Infinity — ядро на конец партии; неизвестный раунд (null) — исходное ядро.
export function coreAt(core, swap, round) {
  return swap && typeof round === 'number' && round >= swap.round ? swap.core : core;
}

// Проверка честности в конце партии: каждый ответ игрока согласуется с ядром,
// которое действовало в раунде этого ответа (с учётом подмены).
// answers: [{ index, answer, round }]. Возвращает список несовпадений (пустой — всё честно).
export function findLies(coreIndex, answers, swap = null) {
  const valid = (i) => Number.isInteger(i) && i >= 0 && i < PIECES;
  if (!valid(coreIndex) || (swap && !valid(swap.core))) {
    return [{ index: coreIndex, answer: null, expected: null, kind: 'bad-core' }];
  }
  const expected = (a) => (a.index === coreAt(coreIndex, swap, a.round) ? 'core' : 'dummy');
  return answers.filter((a) => a.answer !== expected(a)).map((a) => ({ ...a, expected: expected(a) }));
}

// Проверка подмены в конце партии (всё, кроме отпечатка: его сверяет crypto.js в сетевом слое).
// swap — то, что игрок раскрыл в final: null | { core, salt, round }.
// Возвращает null, если всё честно, иначе { kind, ... }.
export function checkSwap(state, player, core, swap) {
  const pub = state.swaps?.[player] || null;
  if (pub && !swap) return { kind: 'swap-missing', round: pub.round };
  if (!pub && swap) return { kind: 'swap-extra' };
  if (!pub) return null;
  if (!Number.isInteger(swap.core) || swap.core < 0 || swap.core >= PIECES) return { kind: 'swap-bad', round: pub.round };
  if (swap.round !== pub.round) return { kind: 'swap-round', round: pub.round };
  if (swap.core === core) return { kind: 'swap-same', round: pub.round, index: swap.core };
  // Фишка должна быть жива в начале раунда подмены: сбитые раньше раскрыты в раунде < R.
  const target = state.pieces.find((p) => p.owner === player && p.index === swap.core);
  const deadRound = state.revealRound?.[target.id];
  if (Number.isInteger(deadRound) && deadRound < pub.round) return { kind: 'swap-dead', round: pub.round, index: swap.core };
  return null;
}

// Все ответы, которые игрок `player` дал за партию и которые видит `viewer`:
// публичные раскрытия его фишек + ответы на сканы самого viewer.
export function answersOf(state, player, viewer) {
  const out = [];
  for (const p of state.pieces) {
    if (p.owner === player && state.reveals[p.id]) {
      out.push({ index: p.index, answer: state.reveals[p.id], kind: 'hit', round: state.revealRound?.[p.id] ?? null });
    }
  }
  for (const sc of state.private[viewer]?.scans || []) {
    const p = state.pieces.find((q) => q.id === sc.targetId);
    if (p && p.owner === player) out.push({ index: p.index, answer: sc.answer, kind: 'scan', round: sc.round });
  }
  return out;
}

// Снимок для игрока: всё публичное + только его приватная часть.
// Хост отправляет гостю viewFor(state, 'guest').
export function viewFor(state, player) {
  const s = clone(state);
  s.private = { [player]: s.private[player] };
  // Скан чужой фишки: факт и цель видят оба, ответ — только сканирующий (он в private).
  return s;
}
