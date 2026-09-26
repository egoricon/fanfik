// Тесты правил на встроенном node:test. Запуск: node --test
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, resolveRound, resolveMoves, applyReveals, applyScanAnswer, answerFor,
  normalizeOrders, viewFor, findLies, answersOf, forfeit, isEdge, START, SIZE,
} from './rules.js';
import { makeSalt, commit, verify } from './crypto.js';

// Партия с заданными позициями: layout { h0: [r, c], g1: [r, c], ... }.
// Фишки, не названные в layout, убираются с поля (считаются уничтоженными пустышками).
function game(layout, { round = 1, hostCore = 0, guestCore = 0 } = {}) {
  const s = createGame({ hostCore, guestCore });
  s.round = round;
  for (const p of s.pieces) {
    if (layout[p.id]) [p.r, p.c] = layout[p.id];
    else { p.alive = false; s.reveals[p.id] = 'dummy'; }
  }
  return s;
}

const pos = (s, id) => {
  const p = s.pieces.find((q) => q.id === id);
  return [p.r, p.c];
};
const alive = (s, id) => s.pieces.find((q) => q.id === id).alive;

// Честные ответы владельцев на все ожидающие раскрытия.
function revealAll(s) {
  const answers = {};
  for (const id of s.pendingReveals) {
    const p = s.pieces.find((q) => q.id === id);
    answers[id] = answerFor(s.private[p.owner].core, p);
  }
  return applyReveals(s, answers);
}

const orders = (moves = [null, null, null], action = null) => ({ moves, action });

describe('старт партии (правило 1)', () => {
  test('по 3 фишки в крайних рядах, в колонках 1–3 от лица каждого', () => {
    const s = createGame();
    assert.deepEqual(START.host, [{ r: 4, c: 0 }, { r: 4, c: 1 }, { r: 4, c: 2 }]);
    assert.deepEqual(START.guest, [{ r: 0, c: 4 }, { r: 0, c: 3 }, { r: 0, c: 2 }]);
    assert.equal(s.pieces.length, 6);
    assert.equal(s.round, 1);
    assert.equal(s.phase, 'planning');
  });
});

describe('движение (правило 4)', () => {
  test('обычный шаг', () => {
    const s = game({ h0: [2, 2] });
    const { state } = resolveRound(s, { host: orders(['up']) });
    assert.deepEqual(pos(state, 'h0'), [1, 2]);
  });

  test('две фишки претендуют на одну клетку → обе остаются', () => {
    const s = game({ h0: [2, 1], g0: [2, 3] });
    const { state, events } = resolveRound(s, { host: orders(['right']), guest: orders(['left']) });
    assert.deepEqual(pos(state, 'h0'), [2, 1]);
    assert.deepEqual(pos(state, 'g0'), [2, 3]);
    assert.ok(events.filter((e) => e.type === 'move').every((e) => !e.ok && e.reason === 'contest'));
  });

  test('конфликт своих фишек тоже блокирует обе', () => {
    const s = game({ h0: [2, 1], h1: [2, 3] });
    const { state } = resolveRound(s, { host: orders(['right', 'left']) });
    assert.deepEqual(pos(state, 'h0'), [2, 1]);
    assert.deepEqual(pos(state, 'h1'), [2, 3]);
  });

  test('обмен местами → обе остаются', () => {
    const s = game({ h0: [2, 2], g0: [1, 2] });
    const { state, events } = resolveRound(s, { host: orders(['up']), guest: orders(['down']) });
    assert.deepEqual(pos(state, 'h0'), [2, 2]);
    assert.deepEqual(pos(state, 'g0'), [1, 2]);
    assert.ok(events.filter((e) => e.type === 'move').every((e) => e.reason === 'swap'));
  });

  test('шаг в клетку стоящей фишки → остаётся', () => {
    const s = game({ h0: [2, 2], g0: [1, 2] });
    const { state, events } = resolveRound(s, { host: orders(['up']) });
    assert.deepEqual(pos(state, 'h0'), [2, 2]);
    assert.equal(events[0].reason, 'occupied');
  });

  test('шаг в клетку, которую фишка освобождает → проходит («паровозик»)', () => {
    const s = game({ h0: [3, 2], h1: [2, 2] });
    const { state } = resolveRound(s, { host: orders(['up', 'up']) });
    assert.deepEqual(pos(state, 'h0'), [2, 2]);
    assert.deepEqual(pos(state, 'h1'), [1, 2]);
  });

  test('блокировка распространяется по цепочке, пока позиции не стабилизируются', () => {
    // g0 стоит; h1 упирается в g0; h0 шёл в клетку h1 и тоже остаётся; h2 шёл в клетку h0 и остаётся.
    const s = game({ g0: [1, 2], h1: [2, 2], h0: [3, 2], h2: [4, 2] });
    const { state } = resolveRound(s, { host: orders(['up', 'up', 'up']) });
    assert.deepEqual(pos(state, 'h1'), [2, 2]);
    assert.deepEqual(pos(state, 'h0'), [3, 2]);
    assert.deepEqual(pos(state, 'h2'), [4, 2]);
  });

  test('проигравшие спор за клетку блокируют тех, кто шёл за ними', () => {
    // h0 и g0 спорят за (2,2); h1 шёл в клетку h0 → тоже стоит.
    const s = game({ h0: [2, 1], g0: [2, 3], h1: [2, 0] });
    const { state } = resolveRound(s, { host: orders(['right', 'right']), guest: orders(['left']) });
    assert.deepEqual(pos(state, 'h1'), [2, 0]);
  });

  test('кольцо из 4 фишек блокируется как обмен', () => {
    const s = game({ h0: [1, 1], h1: [1, 2], h2: [2, 2], g0: [2, 1] });
    const { state, events } = resolveRound(s, { host: orders(['right', 'down', 'left']), guest: orders(['up']) });
    assert.deepEqual(pos(state, 'h0'), [1, 1]);
    assert.deepEqual(pos(state, 'g0'), [2, 1]);
    assert.ok(events.filter((e) => e.type === 'move').every((e) => e.reason === 'cycle'));
  });

  test('шаг за край поля считается «стоять»', () => {
    const { positions, moves } = resolveMoves([{ id: 'h0', r: 4, c: 0 }], { h0: 'down' });
    assert.deepEqual(positions.h0, { r: 4, c: 0 });
    assert.equal(moves[0].reason, 'edge');
  });
});

describe('выстрелы (правило 5)', () => {
  test('выстрел идёт от позиции ПОСЛЕ движения', () => {
    // h0 уходит с линии огня g0 и одновременно стреляет вверх со своей новой позиции.
    const s = game({ h0: [3, 1], g0: [0, 2], g1: [0, 1] }, { guestCore: 1 });
    const { state, events } = resolveRound(s, {
      host: orders(['right'], { type: 'shot', piece: 0, dir: 'up' }),
      guest: orders([null, null], { type: 'shot', piece: 1, dir: 'down' }),
    });
    assert.ok(alive(state, 'h0'), 'h0 ушёл из-под выстрела');
    assert.ok(!alive(state, 'g0'), 'h0 попал в g0 с новой клетки');
    assert.equal(events.find((e) => e.type === 'shot' && e.by === 'guest').hitId, null);
  });

  test('поражает первую фишку на пути, дальше не летит', () => {
    const s = game({ h0: [4, 2], g0: [2, 2], g1: [0, 2] });
    const { state } = resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'up' }) });
    assert.ok(!alive(state, 'g0'));
    assert.ok(alive(state, 'g1'));
  });

  test('выстрел по своим: первая фишка на пути — своя', () => {
    const s = game({ h0: [4, 2], h1: [3, 2], g0: [0, 2] });
    const { state } = resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'up' }) });
    assert.ok(!alive(state, 'h1'));
    assert.ok(alive(state, 'g0'));
    assert.deepEqual(state.pendingReveals, ['h1']);
  });

  test('промах: трассер доходит до края поля', () => {
    const s = game({ h0: [2, 2], g0: [0, 0] });
    const { events } = resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'left' }) });
    const shot = events.find((e) => e.type === 'shot');
    assert.equal(shot.hitId, null);
    assert.deepEqual(shot.end, { r: 2, c: 0 });
  });

  test('выстрелы одновременны: сбитая фишка успевает выстрелить', () => {
    const s = game({ h0: [3, 2], g0: [1, 2] });
    const { state } = resolveRound(s, {
      host: orders([], { type: 'shot', piece: 0, dir: 'up' }),
      guest: orders([], { type: 'shot', piece: 0, dir: 'down' }),
    });
    assert.ok(!alive(state, 'h0'));
    assert.ok(!alive(state, 'g0'));
  });

  test('поражённую фишку раскрывает владелец: пустышка — игра идёт', () => {
    const s = game({ h0: [4, 2], g0: [2, 2], g1: [0, 0] }, { guestCore: 1 });
    let { state } = resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'up' }) });
    assert.equal(state.phase, 'reveal');
    state = revealAll(state);
    assert.equal(state.reveals.g0, 'dummy');
    assert.equal(state.phase, 'planning');
    assert.equal(state.round, 2);
  });

  test('без ответа владельца раунд не завершается', () => {
    const s = game({ h0: [4, 2], g0: [2, 2] });
    const { state } = resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'up' }) });
    assert.throws(() => applyReveals(state, {}));
  });
});

describe('победа и ничья (правило 6)', () => {
  test('уничтожено ядро → его владелец проиграл', () => {
    const s = game({ h0: [4, 2], g0: [2, 2], g1: [0, 0] }, { guestCore: 0 });
    const { state } = resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'up' }) });
    const end = revealAll(state);
    assert.equal(end.phase, 'over');
    assert.deepEqual(end.result, { winner: 'host', reason: 'core' });
  });

  test('своё ядро, сбитое своим выстрелом, — тоже поражение', () => {
    const s = game({ h0: [4, 2], h1: [3, 2], g0: [0, 0] }, { hostCore: 1 });
    const { state } = resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'up' }) });
    assert.deepEqual(revealAll(state).result, { winner: 'guest', reason: 'core' });
  });

  test('ядра обоих в одном раунде → ничья', () => {
    const s = game({ h0: [3, 2], g0: [1, 2] }, { hostCore: 0, guestCore: 0 });
    const { state } = resolveRound(s, {
      host: orders([], { type: 'shot', piece: 0, dir: 'up' }),
      guest: orders([], { type: 'shot', piece: 0, dir: 'down' }),
    });
    assert.deepEqual(revealAll(state).result, { winner: null, reason: 'both-cores' });
  });

  test('ядро от выстрела и ядро от огня в одном раунде → ничья', () => {
    const s = game({ h0: [0, 0], h1: [3, 3], g0: [2, 3] }, { round: 7, hostCore: 0, guestCore: 0 });
    const { state } = resolveRound(s, { host: orders([], { type: 'shot', piece: 1, dir: 'up' }) });
    assert.deepEqual(revealAll(state).result, { winner: null, reason: 'both-cores' });
  });
});

describe('горящее кольцо и лимит раундов (правило 7)', () => {
  test('краевые клетки: ровно 16', () => {
    let n = 0;
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) if (isEdge(r, c)) n++;
    assert.equal(n, 16);
  });

  test('до 7-го раунда край не горит', () => {
    const s = game({ h0: [4, 0], g0: [2, 2] }, { round: 6 });
    const { state } = resolveRound(s, {});
    assert.ok(alive(state, 'h0'));
    assert.equal(state.round, 7);
  });

  test('с 7-го раунда фишки на краю сгорают с раскрытием', () => {
    const s = game({ h0: [4, 0], h1: [2, 2], g0: [0, 3], g1: [1, 1] }, { round: 7, hostCore: 1, guestCore: 1 });
    const { state, events } = resolveRound(s, {});
    assert.ok(!alive(state, 'h0'));
    assert.ok(!alive(state, 'g0'));
    assert.ok(alive(state, 'h1'));
    assert.ok(alive(state, 'g1'));
    assert.deepEqual(events.filter((e) => e.cause === 'fire').map((e) => e.id).sort(), ['g0', 'h0']);
    const next = revealAll(state);
    assert.equal(next.reveals.h0, 'dummy');
    assert.equal(next.phase, 'planning');
  });

  test('огонь после движения: ушедшая с края фишка выживает', () => {
    const s = game({ h0: [4, 2], g0: [2, 2] }, { round: 8 });
    const { state } = resolveRound(s, { host: orders(['up']) });
    assert.ok(alive(state, 'h0'));
  });

  test('огонь после выстрелов: сбитая выстрелом фишка не сгорает второй раз', () => {
    const s = game({ h0: [2, 2], g0: [2, 4], g1: [1, 1] }, { round: 7, guestCore: 1 });
    const { events } = resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'right' }) });
    assert.deepEqual(events.filter((e) => e.type === 'destroyed').map((e) => [e.id, e.cause]), [['g0', 'shot']]);
  });

  test('сгорело ядро → поражение', () => {
    const s = game({ h0: [1, 1], g0: [0, 2], g1: [2, 2] }, { round: 9, guestCore: 0 });
    const { state } = resolveRound(s, {});
    assert.deepEqual(revealAll(state).result, { winner: 'host', reason: 'core' });
  });

  test('конец 10-го раунда без сбитых ядер → ничья', () => {
    const s = game({ h0: [1, 1], g0: [2, 2] }, { round: 10 });
    const { state } = resolveRound(s, {});
    assert.deepEqual(state.result, { winner: null, reason: 'rounds' });
  });

  test('ядро сбито в 10-м раунде → победа, а не ничья', () => {
    const s = game({ h0: [3, 2], g0: [1, 2] }, { round: 10, guestCore: 0 });
    const { state } = resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'up' }) });
    assert.deepEqual(revealAll(state).result, { winner: 'host', reason: 'core' });
  });
});

describe('дедлайн (правило 8)', () => {
  test('нет приказов → все фишки стоят, действия нет', () => {
    const s = game({ h0: [3, 2], g0: [1, 2] });
    const { state, events } = resolveRound(s, {
      host: null,
      guest: orders(['left'], { type: 'shot', piece: 0, dir: 'down' }),
    });
    assert.deepEqual(pos(state, 'h0'), [3, 2]);
    assert.deepEqual(pos(state, 'g0'), [1, 1]);
    assert.equal(events.filter((e) => e.by === 'host').length, 0);
    assert.equal(events.filter((e) => e.type === 'move' && e.id.startsWith('h')).length, 0);
  });

  test('оба не прислали → раунд просто проходит', () => {
    const s = game({ h0: [3, 2], g0: [1, 2] });
    const { state } = resolveRound(s, { host: undefined, guest: undefined });
    assert.equal(state.round, 2);
    assert.deepEqual(pos(state, 'h0'), [3, 2]);
  });

  test('мусорные приказы превращаются в «стоять»', () => {
    const s = createGame();
    const o = normalizeOrders(s, 'host', { moves: ['north', 5, 'up'], action: { type: 'shot', piece: 7, dir: 'up' } });
    assert.deepEqual(o, { moves: [null, null, 'up'], action: null });
  });
});

describe('скан (правило 3)', () => {
  test('скан один раз за игру, ответ получает только сканирующий', () => {
    const s = game({ h0: [4, 0], g0: [0, 4], g1: [0, 3] }, { guestCore: 1 });
    let { state, events } = resolveRound(s, { host: orders([], { type: 'scan', target: 1 }) });
    assert.deepEqual(events.find((e) => e.type === 'scan'), { type: 'scan', by: 'host', targetId: 'g1' });
    assert.equal(state.phase, 'reveal');
    state = applyScanAnswer(state, 'core');
    assert.equal(state.phase, 'planning');
    assert.deepEqual(state.private.host.scans, [{ targetId: 'g1', answer: 'core', round: 1 }]);
    assert.equal(viewFor(state, 'guest').private.host, undefined);
    // Второй скан отбрасывается.
    assert.equal(normalizeOrders(state, 'host', orders([], { type: 'scan', target: 0 })).action, null);
  });
});

describe('viewFor', () => {
  test('гость не видит ядро хоста', () => {
    const s = createGame({ hostCore: 2 });
    const v = viewFor(s, 'guest');
    assert.equal(v.private.host, undefined);
    assert.ok(!JSON.stringify(v).includes('"core":2'));
    assert.equal(s.private.host.core, 2, 'исходное состояние не изменено');
  });
});

describe('честность', () => {
  test('findLies находит ответ, не совпадающий с ядром', () => {
    assert.deepEqual(findLies(1, [{ index: 0, answer: 'dummy' }, { index: 1, answer: 'core' }]), []);
    const lies = findLies(1, [{ index: 1, answer: 'dummy', kind: 'hit' }]);
    assert.equal(lies.length, 1);
    assert.equal(lies[0].expected, 'core');
  });

  test('answersOf собирает раскрытия и ответы на свои сканы', () => {
    let s = game({ h0: [4, 2], g0: [2, 2], g1: [0, 0] }, { guestCore: 1 });
    s = revealAll(resolveRound(s, { host: orders([], { type: 'shot', piece: 0, dir: 'up' }) }).state);
    s = applyScanAnswer(resolveRound(s, { host: orders([], { type: 'scan', target: 1 }) }).state, 'core');
    const answers = answersOf(s, 'guest', 'host');
    assert.deepEqual(answers.map((a) => [a.index, a.answer, a.kind]).sort(), [
      [0, 'dummy', 'hit'], [1, 'core', 'scan'], [2, 'dummy', 'hit'],
    ]);
    assert.deepEqual(findLies(1, answers), []);
    assert.equal(findLies(0, answers).length, 2);
  });

  test('forfeit засчитывает поражение ушедшему', () => {
    assert.deepEqual(forfeit(createGame(), 'guest').result, { winner: 'host', reason: 'forfeit' });
  });
});

describe('crypto.js (commit-reveal)', () => {
  test('commit/verify: правильное раскрытие проходит', async () => {
    const salt = makeSalt();
    assert.match(salt, /^[0-9a-f]{32}$/);
    const hash = await commit(2, salt);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(await verify(2, salt, hash));
  });

  test('подмена данных или соли не проходит', async () => {
    const salt = makeSalt();
    const hash = await commit({ moves: ['up', null, null], action: null }, salt);
    assert.ok(!(await verify({ moves: ['down', null, null], action: null }, salt, hash)));
    assert.ok(!(await verify({ moves: ['up', null, null], action: null }, makeSalt(), hash)));
  });

  test('порядок ключей не влияет на хэш', async () => {
    const salt = makeSalt();
    const a = await commit({ moves: [null], action: { type: 'shot', piece: 0, dir: 'up' } }, salt);
    const b = await commit({ action: { dir: 'up', piece: 0, type: 'shot' }, moves: [null] }, salt);
    assert.equal(a, b);
  });

  test('соли разные', () => {
    assert.notEqual(makeSalt(), makeSalt());
  });
});
