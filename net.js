// Сетевой слой «Двойников»: комната по ссылке, сообщения, переподключение,
// commit-reveal и судейство хоста. UI передаёт сюда объект ui с колбэками (см. CLAUDE.md).
//
// Транспорт — Trystero (WebRTC, знакомство игроков через публичные nostr-релеи, без своего сервера).
// Изначально по ТЗ был PeerJS, но его сервер 0.peerjs.com отвечал 403 из сети разработчика;
// замену одобрил Егор 2026-09-26. Библиотека грузится с CDN с точной версией.

import * as R from './rules.js';
import { makeSalt, commit, verify } from './crypto.js';

export const TRYSTERO_VERSION = '0.25.4';
// Основной CDN и запасной (если первый недоступен из сети игрока).
export const TRYSTERO_URLS = [
  `https://cdn.jsdelivr.net/npm/trystero@${TRYSTERO_VERSION}/+esm`,
  `https://esm.sh/trystero@${TRYSTERO_VERSION}`,
];
const APP_ID = 'dvoyniki-egoricon-v1';
const ROOM_WAIT_MS = 20000; // гость не нашёл хоста за это время — «комната не найдена»

const PING_MS = 2000; // пульс соединения
const DEAD_MS = 7000; // тишина дольше — соперник отключился
const REDIAL_MS = 3000; // гость переподключается к хосту
const GRACE_MS = 2500; // запас на сеть после дедлайна
const REVEAL_WAIT_MS = 8000; // сколько хост ждёт раскрытия после коммита
export const FORFEIT_MS = 60000; // не вернулся за это время — поражение

// ---------- ссылка на комнату ----------
export function roomFromUrl(loc = globalThis.location) {
  const id = new URLSearchParams(loc.search).get('room');
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

export function roomLink(id, loc = globalThis.location) {
  return `${loc.origin}${loc.pathname}?room=${encodeURIComponent(id)}`;
}

const randomId = () => makeSalt().slice(0, 12);

// ---------- канал сообщений ----------
// Все сообщения — JSON { type, seq, sid, ... }. seq растёт у отправителя, sid — id вкладки
// отправителя (после перезагрузки seq начинается заново). Дубли по sid:seq отбрасываются.
// Важные сообщения текущего этапа лежат в outbox и повторяются после переподключения.
class Link {
  constructor(onMessage, onAlive) {
    this.onMessage = onMessage;
    this.onAlive = onAlive;
    this.sid = randomId();
    this.seq = 0;
    this.seen = new Set();
    this.outbox = [];
    this.conn = null;
    this.alive = false;
    this.lastHeard = 0;
    this.timer = setInterval(() => this.tick(), PING_MS);
  }

  attach(conn) {
    if (this.conn === conn) {
      if (conn.open) this.opened();
      return;
    }
    if (this.conn) {
      try { this.conn.close(); } catch { /* старое соединение уже мертво */ }
    }
    this.conn = conn;
    conn.on('data', (d) => this.receive(conn, d));
    conn.on('close', () => { if (this.conn === conn) this.setAlive(false); });
    conn.on('error', () => { if (this.conn === conn) this.setAlive(false); });
    if (conn.open) this.opened();
    else conn.on('open', () => { if (this.conn === conn) this.opened(); });
  }

  opened() {
    this.lastHeard = Date.now();
    this.setAlive(true);
  }

  setAlive(v) {
    if (this.alive === v) return;
    this.alive = v;
    this.onAlive(v);
  }

  send(type, data = {}, { keep = true } = {}) {
    const msg = { ...data, type, seq: ++this.seq, sid: this.sid };
    if (keep) this.outbox.push(msg);
    this.raw(msg);
    return msg;
  }

  raw(msg) {
    if (!this.conn?.open) return;
    try { this.conn.send(msg); } catch { /* отправится повтором из outbox */ }
  }

  resend() {
    for (const m of this.outbox) this.raw(m);
  }

  clearOutbox() {
    this.outbox = [];
  }

  receive(conn, d) {
    if (conn !== this.conn) return;
    let msg = d;
    if (typeof d === 'string') {
      try { msg = JSON.parse(d); } catch { return; }
    }
    if (!msg || typeof msg.type !== 'string' || !Number.isInteger(msg.seq)) return;
    this.lastHeard = Date.now();
    this.setAlive(true);
    if (msg.type === 'ping') return;
    const key = `${msg.sid}:${msg.seq}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.onMessage(msg);
  }

  tick() {
    if (!this.conn?.open) {
      this.setAlive(false);
      return;
    }
    this.raw({ type: 'ping', seq: 0, sid: this.sid });
    if (Date.now() - this.lastHeard > DEAD_MS) this.setAlive(false);
  }

  close() {
    clearInterval(this.timer);
    try { this.conn?.close(); } catch { /* ignore */ }
  }
}

// ---------- транспорт поверх Trystero ----------
// Даёт хосту и гостю «соединения» с интерфейсом { open, send, close, on/off('open'|'data'|'close') }.
let trysteroLib = null;
async function loadTrystero() {
  if (trysteroLib) return trysteroLib;
  for (const url of TRYSTERO_URLS) {
    try {
      trysteroLib = await import(url);
      if (typeof trysteroLib.joinRoom === 'function') return trysteroLib;
    } catch { /* пробуем следующий CDN */ }
  }
  return null;
}

class Emitter {
  constructor() { this.handlers = {}; }
  on(e, f) { (this.handlers[e] ||= []).push(f); return this; }
  off(e, f) { this.handlers[e] = (this.handlers[e] || []).filter((x) => x !== f); return this; }
  emit(e, ...args) { for (const f of (this.handlers[e] || []).slice()) f(...args); }
}

class PeerConn extends Emitter {
  constructor(transport, peerId) {
    super();
    this.transport = transport;
    this.peerId = peerId;
    this.open = false;
  }
  send(data) {
    if (!this.open) throw new Error('соединение закрыто');
    this.transport.action.send(data, { target: this.peerId }).catch(() => {});
  }
  close() { /* в Trystero нельзя закрыть одного пира; просто перестаём слушать */ }
  setOpen(v) {
    if (this.open === v) return;
    this.open = v;
    this.emit(v ? 'open' : 'close');
  }
}

class Transport extends Emitter {
  constructor(lib, roomId) {
    super();
    this.lib = lib;
    this.conns = new Map();
    this.room = lib.joinRoom({ appId: APP_ID }, roomId);
    this.action = this.room.makeAction('m');
    this.room.onPeerJoin = (pid) => {
      const c = this.conn(pid);
      c.setOpen(true);
      this.emit('join', c);
    };
    this.room.onPeerLeave = (pid) => this.conns.get(pid)?.setOpen(false);
    this.action.onMessage = (data, ctx) => {
      const c = this.conn(ctx.peerId);
      if (!c.open) c.setOpen(true);
      c.emit('data', data);
    };
    // Возврат на вкладку: будим переподключение к релеям (аналог peer.reconnect() в PeerJS).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        try { lib.resumeRelayReconnection?.(); } catch { /* ignore */ }
        this.emit('wake');
      }
    });
  }
  conn(pid) {
    let c = this.conns.get(pid);
    if (!c) this.conns.set(pid, (c = new PeerConn(this, pid)));
    return c;
  }
  leave() {
    try { this.room.leave(); } catch { /* ignore */ }
  }
}

async function openTransport(ui, roomId) {
  const lib = await loadTrystero();
  if (!lib) {
    ui.fatal('Не загрузилась сетевая библиотека. Проверь интернет и обнови страницу.');
    return null;
  }
  if (typeof RTCPeerConnection !== 'function') {
    ui.fatal('Этот браузер не поддерживает WebRTC.');
    return null;
  }
  return new Transport(lib, roomId);
}

// Проверка честности соперника в конце партии.
// Возвращает { ok, checked, detail }.
async function checkHonesty(coreHash, core, salt, answers) {
  if (!(await verify(core, salt, coreHash))) {
    return { ok: false, checked: answers.length, detail: { kind: 'commit', core } };
  }
  const lies = R.findLies(core, answers);
  if (lies.length) return { ok: false, checked: answers.length, detail: { kind: 'answer', core, lie: lies[0] } };
  return { ok: true, checked: answers.length };
}

// Все три фишки игрока раскрыты как «пустышка» — так не бывает, ядро одно из трёх.
// Ловим сразу, не дожидаясь конца партии (иначе лжец доиграл бы до 10-го раунда без фишек).
function allDummies(view, player) {
  const mine = view.pieces.filter((p) => p.owner === player);
  return mine.length > 0 && mine.every((p) => view.reveals[p.id] === 'dummy');
}

// Разбор приказов из сети: только ожидаемая форма, остальное rules.js нормализует сам.
const ordersShape = (o) => (o === null || (typeof o === 'object' && !Array.isArray(o)) ? o : null);

// =====================================================================
// Хост: единственный судья. Держит полное состояние, дедлайн, вызывает rules.js.
// Гостю уходит только viewFor(state, 'guest') и лог событий раунда.
// =====================================================================
export function createHost(ui) {
  const roomId = randomId();
  let transport = null;
  let left = false;
  let guestToken = null;
  let forfeitTimer = null;
  let roundTimers = [];

  const M = {
    stage: 'lobby', // lobby | core | planning | answers | replay | over
    state: null,
    prev: null,
    core: null, salt: null, coreHash: null,
    guestCoreHash: null,
    r: null, // данные раунда
    ask: null, // ожидаемые ответы гостя
    ready: new Set(),
    rematch: new Set(),
    lastReplay: null,
    guestFinal: null,
    honesty: null,
  };

  const link = new Link(onMessage, onAlive);

  openTransport(ui, roomId).then((t) => {
    if (!t) return;
    if (left) return t.leave();
    transport = t;
    ui.lobby(roomLink(roomId));
    t.on('join', (conn) => {
      if (conn.helloBound) return;
      conn.helloBound = true;
      conn.on('data', (m) => {
        if (m?.type !== 'hello' || typeof m.token !== 'string') return;
        if (guestToken && m.token !== guestToken) {
          // Комната занята: в неё уже вошёл другой гость.
          try { conn.send({ type: 'full', seq: 0, sid: link.sid }); } catch { /* ignore */ }
          return;
        }
        const first = !guestToken;
        guestToken = m.token;
        link.attach(conn);
        if (first) newMatch();
        else {
          // Гость вернулся: повторяем важные сообщения этапа и шлём снимок состояния.
          link.resend();
          sendSnapshot();
        }
      });
    });
  });

  function onAlive(alive) {
    if (!guestToken) return;
    if (alive) {
      clearTimeout(forfeitTimer);
      forfeitTimer = null;
      ui.disconnected(false);
    } else if (M.stage !== 'over' && M.stage !== 'lobby') {
      ui.disconnected(true, Date.now() + FORFEIT_MS);
      clearTimeout(forfeitTimer);
      forfeitTimer = setTimeout(() => endByForfeit('guest'), FORFEIT_MS);
    }
  }

  function endByForfeit(loser) {
    clearRoundTimers();
    M.state = R.forfeit(M.state || R.createGame({ hostCore: M.core }), loser);
    M.stage = 'over';
    link.send('forfeit', { loser });
    ui.disconnected(false);
    ui.final(finalInfo());
  }

  function newMatch() {
    clearRoundTimers();
    Object.assign(M, {
      stage: 'core', state: null, prev: null, core: null, salt: null, coreHash: null, guestCoreHash: null,
      r: null, ask: null, lastReplay: null, guestFinal: null, honesty: null,
    });
    M.ready.clear();
    M.rematch.clear();
    link.clearOutbox();
    link.send('newMatch');
    ui.corePick();
  }

  function sendSnapshot() {
    link.send('snapshot', {
      stage: M.stage,
      hostCoreHash: M.coreHash,
      guestCoreKnown: !!M.guestCoreHash,
      view: M.state ? R.viewFor(M.state, 'guest') : null,
      round: M.state?.round ?? 0,
      remainingMs: M.r ? Math.max(0, M.r.deadline - Date.now()) : 0,
      hostCommitted: M.r ? M.r.commits.host !== undefined : false,
      guestCommitted: M.r ? M.r.commits.guest !== undefined : false,
      replay: M.stage === 'replay' || M.stage === 'over' ? M.lastReplay : null,
    }, { keep: false });
  }

  function clearRoundTimers() {
    roundTimers.forEach(clearTimeout);
    roundTimers = [];
  }

  function maybeStart() {
    if (M.stage === 'core' && M.coreHash && M.guestCoreHash) {
      M.state = R.createGame({ hostCore: M.core });
      startRound();
    }
  }

  function startRound() {
    clearRoundTimers();
    M.stage = 'planning';
    M.ready.clear();
    link.clearOutbox();
    const deadline = Date.now() + R.ROUND_SECONDS * 1000;
    M.r = { commits: {}, reveals: {}, deadline, revealSent: false };
    link.send('round', { round: M.state.round, view: R.viewFor(M.state, 'guest'), remainingMs: R.ROUND_SECONDS * 1000 });
    ui.planning({ view: R.viewFor(M.state, 'host'), deadline, round: M.state.round, core: M.core });
    const round = M.state.round;
    // Дедлайн хоста: свои приказы не отправлены — стоим.
    roundTimers.push(setTimeout(() => {
      if (M.stage === 'planning' && M.state.round === round && M.r.commits.host === undefined) {
        ui.timeUp();
        submitOrders(null);
      }
    }, deadline - Date.now()));
    // После запаса: гость не прислал коммит — у него приказов нет (правило 8).
    roundTimers.push(setTimeout(() => {
      if (M.stage !== 'planning' || M.state.round !== round) return;
      if (M.r.commits.guest === undefined) {
        M.r.commits.guest = null;
        link.send('timeout', { round });
      }
      maybeReveal();
      maybeResolve();
    }, deadline - Date.now() + GRACE_MS));
    // Коммит был, а раскрытия нет (гость пропал) — тоже без приказов.
    roundTimers.push(setTimeout(() => {
      if (M.stage !== 'planning' || M.state.round !== round) return;
      if (M.r.commits.guest && M.r.reveals.guest === undefined) M.r.reveals.guest = null;
      maybeResolve();
    }, deadline - Date.now() + GRACE_MS + REVEAL_WAIT_MS));
  }

  async function submitOrders(orders) {
    if (M.stage !== 'planning' || M.r.commits.host !== undefined) return;
    const round = M.state.round;
    if (orders === null) {
      M.r.commits.host = null;
      M.r.reveals.host = { orders: null, salt: null };
    } else {
      const salt = makeSalt();
      M.r.commits.host = 'pending';
      const hash = await commit(orders, salt);
      M.r.commits.host = hash;
      M.r.reveals.host = { orders, salt };
    }
    link.send('ordersCommit', { round, hash: M.r.commits.host });
    maybeReveal();
    maybeResolve();
  }

  // Хост раскрывает свои приказы только когда знает коммит гостя.
  function maybeReveal() {
    const r = M.r;
    if (!r || r.revealSent || r.commits.guest === undefined) return;
    if (r.commits.host === undefined || r.commits.host === 'pending') return;
    r.revealSent = true;
    link.send('ordersReveal', { round: M.state.round, orders: r.reveals.host.orders, salt: r.reveals.host.salt });
  }

  function maybeResolve() {
    const r = M.r;
    if (M.stage !== 'planning' || !r) return;
    if (r.commits.host === undefined || r.commits.host === 'pending' || r.commits.guest === undefined) return;
    if (r.commits.guest !== null && r.reveals.guest === undefined) return;
    resolve();
  }

  function resolve() {
    clearRoundTimers();
    M.stage = 'answers';
    M.prev = M.state;
    const { state } = R.resolveRound(M.state, { host: M.r.reveals.host.orders, guest: M.r.reveals.guest ?? null });
    M.state = state;
    const hostIds = state.pendingReveals.filter((id) => id.startsWith('h'));
    const guestIds = state.pendingReveals.filter((id) => id.startsWith('g'));
    const scanTarget = state.pendingScan?.targetId ?? null;
    M.ask = { answers: {}, scan: null, guestIds, needScan: scanTarget?.startsWith('g') || false };
    // Свои фишки хост раскрывает сам.
    for (const id of hostIds) M.ask.answers[id] = R.answerFor(M.core, piece(id));
    if (scanTarget?.startsWith('h')) M.ask.scan = R.answerFor(M.core, piece(scanTarget));
    if (guestIds.length || M.ask.needScan) {
      link.send('ask', { round: M.prev.round, ids: guestIds, scanTarget: M.ask.needScan ? scanTarget : null });
    } else finishResolve();
  }

  const piece = (id) => M.state.pieces.find((p) => p.id === id);

  function finishResolve() {
    let s = M.state;
    if (s.pendingReveals.length) s = R.applyReveals(s, M.ask.answers);
    if (s.pendingScan) s = R.applyScanAnswer(s, M.ask.scan);
    M.state = s;
    M.ask = null;
    M.stage = s.phase === 'over' ? 'over' : 'replay';
    M.lastReplay = { round: M.prev.round, prev: R.viewFor(M.prev, 'guest'), events: s.lastEvents, view: R.viewFor(s, 'guest') };
    link.send('replay', M.lastReplay);
    if (allDummies(s, 'guest')) return cheater({ kind: 'allDummies' });
    ui.replay({ prev: R.viewFor(M.prev, 'host'), events: s.lastEvents, view: R.viewFor(s, 'host') });
    if (M.stage === 'over') link.send('final', { core: M.core, salt: M.salt });
  }

  async function onMessage(m) {
    switch (m.type) {
      case 'coreCommit':
        if (M.stage !== 'core' || typeof m.hash !== 'string') return;
        M.guestCoreHash = m.hash;
        ui.opponentCore();
        maybeStart();
        break;
      case 'ordersCommit':
        if (M.stage !== 'planning' || m.round !== M.state.round || M.r.commits.guest !== undefined) return;
        M.r.commits.guest = typeof m.hash === 'string' ? m.hash : null;
        ui.opponentReady();
        maybeReveal();
        maybeResolve();
        break;
      case 'ordersReveal': {
        if (M.stage !== 'planning' || m.round !== M.state.round || !M.r.commits.guest || M.r.reveals.guest !== undefined) return;
        const orders = ordersShape(m.orders);
        if (!(await verify(orders, m.salt, M.r.commits.guest))) {
          return cheater({ kind: 'orders', round: m.round });
        }
        M.r.reveals.guest = orders;
        maybeResolve();
        break;
      }
      case 'answers': {
        if (M.stage !== 'answers' || !M.ask || m.round !== M.prev.round) return;
        for (const id of M.ask.guestIds) {
          const a = m.answers?.[id];
          if (a !== 'core' && a !== 'dummy') return;
          M.ask.answers[id] = a;
        }
        if (M.ask.needScan) {
          if (m.scan !== 'core' && m.scan !== 'dummy') return;
          M.ask.scan = m.scan;
        }
        finishResolve();
        break;
      }
      case 'next':
        if (M.stage === 'replay' && m.round === M.prev?.round) {
          M.ready.add('guest');
          ui.opponentNext();
          maybeNext();
        }
        break;
      case 'final':
        M.guestFinal = { core: m.core, salt: m.salt };
        await runHonesty();
        break;
      case 'rematch':
        if (M.stage !== 'over') return;
        M.rematch.add('guest');
        ui.opponentRematch();
        if (M.rematch.has('host')) newMatch();
        break;
      case 'bye':
        if (M.stage !== 'over' && M.stage !== 'lobby') endByForfeit('guest');
        break;
    }
  }

  async function runHonesty() {
    if (!M.guestFinal || M.stage !== 'over') return;
    const answers = R.answersOf(M.state, 'guest', 'host');
    M.honesty = await checkHonesty(M.guestCoreHash, M.guestFinal.core, M.guestFinal.salt, answers);
    if (!M.honesty.ok) cheater(M.honesty.detail);
    else ui.honesty(finalInfo());
  }

  function cheater(detail) {
    clearRoundTimers();
    M.stage = 'over';
    link.send('cheat', { detail });
    ui.cheater({ ...detail, commit: M.guestCoreHash });
  }

  function maybeNext() {
    if (M.ready.has('host') && M.ready.has('guest')) startRound();
  }

  function finalInfo() {
    return {
      state: M.state,
      view: M.state ? R.viewFor(M.state, 'host') : null,
      me: 'host',
      cores: { host: M.core, guest: M.guestFinal?.core ?? null },
      honesty: M.honesty,
    };
  }

  return {
    role: 'host',
    async chooseCore(index, salt = makeSalt()) {
      if (M.stage !== 'core' || M.coreHash) return null;
      M.core = index;
      M.salt = salt;
      M.coreHash = await commit(index, M.salt);
      link.send('coreCommit', { hash: M.coreHash });
      ui.waitCore(!!M.guestCoreHash);
      maybeStart();
      return M.coreHash;
    },
    previewHash: (index, salt) => commit(index, salt),
    submitOrders,
    next() {
      if (M.stage === 'over') return ui.final(finalInfo());
      if (M.stage !== 'replay') return;
      M.ready.add('host');
      link.send('next', { round: M.prev.round });
      maybeNext();
    },
    finalInfo,
    rematch() {
      if (M.stage !== 'over') return;
      M.rematch.add('host');
      link.send('rematch');
      if (M.rematch.has('guest')) newMatch();
    },
    leave() {
      left = true;
      link.send('bye', {}, { keep: false });
      setTimeout(() => { link.close(); transport?.leave(); }, 300);
    },
  };
}

// =====================================================================
// Гость: ничего не вычисляет по правилам, показывает то, что прислал хост.
// Сам хранит только своё ядро, соль и приказы текущего раунда.
// =====================================================================
export function createGuest(ui, roomId) {
  let transport = null;
  let hostConn = null;
  let token;
  try {
    token = sessionStorage.getItem('dv-token-' + roomId);
    if (!token) sessionStorage.setItem('dv-token-' + roomId, (token = randomId()));
  } catch {
    token = randomId();
  }

  const G = {
    stage: 'connecting', // connecting | core | planning | answers | replay | over
    everConnected: false,
    view: null,
    prevView: null,
    core: null, salt: null, coreHash: null,
    hostCoreHash: null,
    r: null,
    hostFinal: null,
    honesty: null,
    forfeit: null,
  };
  let forfeitTimer = null;

  const link = new Link(onMessage, onAlive);

  const hello = (conn) => {
    try { conn.send({ type: 'hello', seq: 0, sid: link.sid, token }); } catch { /* повторим */ }
  };

  openTransport(ui, roomId).then((t) => {
    if (!t) return;
    transport = t;
    // Хоста заранее не знаем: здороваемся с каждым, кто вошёл в комнату; отвечает только хост.
    t.on('join', (conn) => {
      if (hostConn && conn !== hostConn) return;
      hello(conn);
      if (conn.hostBound) return;
      conn.hostBound = true;
      conn.on('data', (m) => {
        if (hostConn || !m || typeof m.type !== 'string' || m.type === 'hello' || m.type === 'ping') return;
        hostConn = conn;
        link.attach(conn);
        link.receive(conn, m);
      });
    });
    t.on('wake', () => { if (hostConn && !link.alive) hello(hostConn); });
  });
  setTimeout(() => { if (!hostConn) ui.roomNotFound(); }, ROOM_WAIT_MS);
  // Пока связи нет — периодически напоминаем хосту о себе.
  const redial = setInterval(() => {
    if (hostConn && !link.alive && hostConn.open) hello(hostConn);
  }, REDIAL_MS);

  function onAlive(alive) {
    if (alive) {
      if (!G.everConnected) G.everConnected = true;
      clearTimeout(forfeitTimer);
      forfeitTimer = null;
      ui.disconnected(false);
      link.resend();
    } else if (G.everConnected && G.stage !== 'over') {
      ui.disconnected(true, Date.now() + FORFEIT_MS);
      clearTimeout(forfeitTimer);
      // Хост не вернулся — побеждает гость (засчитываем сами: судьи больше нет).
      forfeitTimer = setTimeout(() => {
        G.forfeit = 'host';
        G.stage = 'over';
        const base = G.view || R.viewFor(R.createGame(), 'guest');
        G.view = R.forfeit(base, 'host');
        ui.disconnected(false);
        ui.final(finalInfo());
      }, FORFEIT_MS);
    }
  }

  function reset() {
    Object.assign(G, { stage: 'core', view: null, prevView: null, core: null, salt: null, coreHash: null, hostCoreHash: null, r: null, hostFinal: null, honesty: null, forfeit: null });
    link.clearOutbox();
  }

  function maybeReveal() {
    const r = G.r;
    if (!r || r.revealSent || !r.myCommit || r.myCommit === 'pending' || r.hostCommit === undefined) return;
    r.revealSent = true;
    link.send('ordersReveal', { round: r.round, orders: r.orders, salt: r.salt });
  }

  async function onMessage(m) {
    switch (m.type) {
      case 'full':
        ui.roomFull();
        break;
      case 'newMatch':
        reset();
        ui.corePick();
        break;
      case 'coreCommit':
        if (typeof m.hash === 'string') {
          G.hostCoreHash = m.hash;
          ui.opponentCore();
        }
        break;
      case 'round':
        startPlanning(m.round, m.view, m.remainingMs);
        break;
      case 'ordersCommit':
        if (!G.r || m.round !== G.r.round || G.r.hostCommit !== undefined) return;
        G.r.hostCommit = typeof m.hash === 'string' ? m.hash : null;
        ui.opponentReady();
        maybeReveal();
        break;
      case 'ordersReveal': {
        if (!G.r || m.round !== G.r.round || G.r.hostCommit === undefined) return;
        const orders = ordersShape(m.orders);
        const ok = G.r.hostCommit === null ? orders === null : await verify(orders, m.salt, G.r.hostCommit);
        if (!ok) cheater({ kind: 'orders', round: m.round });
        break;
      }
      case 'timeout':
        if (G.r && m.round === G.r.round && G.r.myCommit === undefined) {
          G.r.myCommit = null;
          ui.timeUp();
        }
        break;
      case 'ask': {
        if (G.core === null || !G.view) return;
        const answers = {};
        for (const id of m.ids || []) {
          const p = G.view.pieces.find((q) => q.id === id && q.owner === 'guest');
          if (p) answers[id] = R.answerFor(G.core, p);
        }
        let scan = null;
        if (m.scanTarget) {
          const p = G.view.pieces.find((q) => q.id === m.scanTarget && q.owner === 'guest');
          if (p) scan = R.answerFor(G.core, p);
        }
        G.stage = 'answers';
        link.send('answers', { round: m.round, answers, scan });
        break;
      }
      case 'replay':
        showReplay(m);
        break;
      case 'snapshot':
        applySnapshot(m);
        break;
      case 'final':
        G.hostFinal = { core: m.core, salt: m.salt };
        await runHonesty();
        break;
      case 'forfeit':
        G.stage = 'over';
        G.forfeit = m.loser;
        G.view = R.forfeit(G.view || R.viewFor(R.createGame(), 'guest'), m.loser);
        ui.final(finalInfo());
        break;
      case 'cheat':
        // Хост считает нечестным нас; показываем его вердикт как есть.
        G.stage = 'over';
        ui.accused(m.detail);
        break;
      case 'rematch':
        ui.opponentRematch();
        break;
    }
  }

  function startPlanning(round, view, remainingMs) {
    G.stage = 'planning';
    G.view = view;
    G.r = { round, hostCommit: undefined, myCommit: undefined, revealSent: false };
    link.clearOutbox();
    ui.planning({ view, deadline: Date.now() + remainingMs, round, core: G.core });
  }

  function showReplay(m) {
    if (G.prevView && G.lastReplayRound === m.round) return;
    G.lastReplayRound = m.round;
    G.prevView = m.prev;
    G.view = m.view;
    G.stage = m.view.phase === 'over' ? 'over' : 'replay';
    if (allDummies(m.view, 'host')) return cheater({ kind: 'allDummies' });
    ui.replay({ prev: m.prev, events: m.events, view: m.view });
    if (G.stage === 'over') {
      link.send('final', { core: G.core, salt: G.salt });
      runHonesty();
    }
  }

  function applySnapshot(s) {
    if (s.hostCoreHash) G.hostCoreHash = s.hostCoreHash;
    if (s.stage === 'core') {
      if (G.stage !== 'core') { reset(); ui.corePick(); }
      else if (G.coreHash) link.resend();
    } else if (s.stage === 'planning') {
      if (!G.r || G.r.round !== s.round) startPlanning(s.round, s.view, s.remainingMs);
      else if (s.hostCommitted) ui.opponentReady();
    } else if ((s.stage === 'replay' || s.stage === 'over') && s.replay) {
      showReplay(s.replay);
    }
  }

  async function runHonesty() {
    if (!G.hostFinal || G.stage !== 'over' || !G.view) return;
    const answers = R.answersOf(G.view, 'host', 'guest');
    G.honesty = await checkHonesty(G.hostCoreHash, G.hostFinal.core, G.hostFinal.salt, answers);
    if (!G.honesty.ok) cheater(G.honesty.detail);
    else ui.honesty(finalInfo());
  }

  function cheater(detail) {
    G.stage = 'over';
    ui.cheater({ ...detail, commit: G.hostCoreHash });
  }

  function finalInfo() {
    return {
      state: G.view,
      view: G.view,
      me: 'guest',
      cores: { guest: G.core, host: G.hostFinal?.core ?? null },
      honesty: G.honesty,
    };
  }

  return {
    role: 'guest',
    async chooseCore(index, salt = makeSalt()) {
      if (G.stage !== 'core' || G.coreHash) return null;
      G.core = index;
      G.salt = salt;
      G.coreHash = await commit(index, G.salt);
      link.send('coreCommit', { hash: G.coreHash });
      ui.waitCore(!!G.hostCoreHash);
      return G.coreHash;
    },
    previewHash: (index, salt) => commit(index, salt),
    async submitOrders(orders) {
      const r = G.r;
      if (G.stage !== 'planning' || !r || r.myCommit !== undefined) return;
      if (orders === null) {
        r.myCommit = null;
      } else {
        r.myCommit = 'pending';
        r.orders = orders;
        r.salt = makeSalt();
        r.myCommit = await commit(orders, r.salt);
      }
      link.send('ordersCommit', { round: r.round, hash: r.myCommit });
      maybeReveal();
    },
    next() {
      if (G.stage === 'over') return ui.final(finalInfo());
      link.send('next', { round: G.lastReplayRound });
    },
    finalInfo,
    rematch() {
      link.send('rematch');
    },
    leave() {
      clearInterval(redial);
      link.send('bye', {}, { keep: false });
      setTimeout(() => { link.close(); transport?.leave(); }, 300);
    },
  };
}
