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
export function createGame({ hostCore = null, guestCore = null } = {}) {
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
    scanUsed: { host: false, guest: false },
    reveals: {}, // публичные раскрытия уничтоженных: pieceId -> 'core' | 'dummy'
    pendingReveals: [], // уничтоженные фишки, ждущие ответа владельца
    pendingScan: null, // { by, targetId } — скан, ждущий ответа владельца цели
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
  }
  return out;
}

// Разрешение движений (правило 4). pieces: живые фишки { id, r, c }, dirs: id -> направление | null.
// Возвращает { positions: id -> {r,c}, moves: [{ id, from, to, ok, reason }] }.
export function resolveMoves(pieces, dirs) {
  const key = (r, c) => r * SIZE + c;
  const target = new Map();
  const reason = new Map(); // id -> причина блокировки
  for (const p of pieces) {
    const d = DIRS[dirs[p.id]];
    const tr = d ? p.r + d.dr : p.r;
    const tc = d ? p.c + d.dc : p.c;
    // Шаг за край поля считается «стоять».
    target.set(p.id, inBounds(tr, tc) ? { r: tr, c: tc } : { r: p.r, c: p.c });
    if (d && !inBounds(tr, tc)) reason.set(p.id, 'edge');
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
export function traceShot(pieces, shooter, dir) {
  const d = DIRS[dir];
  let r = shooter.r + d.dr;
  let c = shooter.c + d.dc;
  let last = { r: shooter.r, c: shooter.c };
  while (inBounds(r, c)) {
    const hit = pieces.find((p) => p.r === r && p.c === c && p.id !== shooter.id);
    if (hit) return { hitId: hit.id, end: { r, c } };
    last = { r, c };
    r += d.dr;
    c += d.dc;
  }
  return { hitId: null, end: last };
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

  // 1. Движения, все одновременно.
  const dirs = {};
  for (const p of alive) dirs[p.id] = orders[p.owner].moves[p.index];
  const { positions, moves } = resolveMoves(alive, dirs);
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
      const { hitId, end } = traceShot(alive, shooter, a.dir);
      events.push({ type: 'shot', by: player, id: shooter.id, dir: a.dir, from: { r: shooter.r, c: shooter.c }, end, hitId });
      if (hitId) hit.add(hitId);
    } else if (a.type === 'scan') {
      const target = s.pieces.find((p) => p.owner === other(player) && p.index === a.target);
      s.scanUsed[player] = true;
      s.pendingScan = { by: player, targetId: target.id };
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
  const done = s.pendingReveals.length === 0 && !s.pendingScan ? finishRound(s) : s;
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
    s.lastEvents.push({ type: 'reveal', id, answer: a });
  }
  s.pendingReveals = [];
  return s.pendingScan ? s : finishRound(s);
}

// Ответ владельца цели на скан. Попадает только в приватную часть сканирующего.
export function applyScanAnswer(state, answer) {
  if (!state.pendingScan) throw new Error('applyScanAnswer: скана нет');
  if (answer !== 'core' && answer !== 'dummy') throw new Error('applyScanAnswer: неверный ответ');
  const s = clone(state);
  const { by, targetId } = s.pendingScan;
  s.private[by].scans.push({ targetId, answer, round: s.round });
  s.pendingScan = null;
  return s.pendingReveals.length ? s : finishRound(s);
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

// Проверка честности в конце партии: все ответы игрока согласуются с раскрытым ядром.
// answers: [{ index, answer }]. Возвращает список несовпадений (пустой — всё честно).
export function findLies(coreIndex, answers) {
  if (!Number.isInteger(coreIndex) || coreIndex < 0 || coreIndex >= PIECES) {
    return [{ index: coreIndex, answer: null, expected: null, kind: 'bad-core' }];
  }
  return answers
    .filter((a) => a.answer !== (a.index === coreIndex ? 'core' : 'dummy'))
    .map((a) => ({ ...a, expected: a.index === coreIndex ? 'core' : 'dummy' }));
}

// Все ответы, которые игрок `player` дал за партию и которые видит `viewer`:
// публичные раскрытия его фишек + ответы на сканы самого viewer.
export function answersOf(state, player, viewer) {
  const out = [];
  for (const p of state.pieces) {
    if (p.owner === player && state.reveals[p.id]) out.push({ index: p.index, answer: state.reveals[p.id], kind: 'hit' });
  }
  for (const sc of state.private[viewer]?.scans || []) {
    const p = state.pieces.find((q) => q.id === sc.targetId);
    if (p && p.owner === player) out.push({ index: p.index, answer: sc.answer, kind: 'scan' });
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
