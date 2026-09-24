const fs = require('fs');
const path = require('path');
const { TITLE, SUBTITLE, chapters, epilogue } = require('./data.js');
const { ICONS } = require('./icons.js');

function esc(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderBlock(b) {
  const reveal = 'data-reveal';
  const impact = b.impact ? ' data-impact' : '';
  if (b.s === 'n') {
    return `<div class="cap" ${reveal}${impact}><p>${esc(b.t)}</p></div>`;
  }
  if (b.s === 'y' || b.s === 'e') {
    const side = b.s === 'y' ? 'left' : 'right';
    const avatarClass = b.s === 'y' ? 'y' : 'e';
    return `<div class="bubble-row ${side}" ${reveal}${impact}>
      <div class="avatar ${avatarClass}"></div>
      <div class="bubble"><p>${esc(b.t)}</p></div>
    </div>`;
  }
  // 'o' — other character
  return `<div class="bubble-other" ${reveal}${impact}>
    <div class="other-name">${esc(b.name || '')}</div>
    <p>${esc(b.t)}</p>
  </div>`;
}

function renderChapter(ch) {
  const blocksHtml = ch.blocks.map(renderBlock).join('\n');
  const isEp = ch.num === 'EP';
  return `
  <section class="chapter${isEp ? ' epilogue' : ''}" id="ch-${ch.num}">
    <div class="chapter-tag">
      <div class="chapter-icon">${ICONS[ch.icon] || ''}</div>
      <div class="chapter-head-text">
        <span class="chnum">${ch.num}</span>
        <span class="chtitle">${esc(ch.title)}</span>
      </div>
    </div>
    <div class="panels">${blocksHtml}</div>
  </section>`;
}

const allChapters = [...chapters, epilogue];
const chapterSections = allChapters.map(renderChapter).join('\n');
const nav = allChapters
  .map((ch) => `<a href="#ch-${ch.num}">${ch.num === 'EP' ? 'Эпилог' : ch.num + '. ' + esc(ch.title)}</a>`)
  .join('');

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(SUBTITLE)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;0,700;1,400;1,700&family=Oswald:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>

<div class="progress-bar" id="progress"></div>

<header class="hero" id="top">
  <div class="hero-kicker">ИЭФ БГУИР · Электронная экономика · Первый курс</div>
  <div class="hero-images" id="heroImages">
    <div class="hero-img-wrap pos-left"><img class="hero-img boy" src="assets/yarik.webp" alt="Ярик Барабанов"></div>
    <div class="hero-img-wrap pos-right"><img class="hero-img girl" src="assets/erika.webp" alt="Эрика Криводубская"></div>
    <div class="petals" id="petals"></div>
  </div>
  <div class="hero-title-wrap">
    <h1 class="hero-title">${esc(TITLE)}</h1>
    <div class="hero-sub">${esc(SUBTITLE)}</div>
  </div>
  <div class="scroll-hint">листай вниз ↓</div>
</header>

<nav class="toc">${nav}</nav>

<section class="cast" data-reveal>
  <div class="cast-grid">
    <div class="cast-card">
      <img src="assets/yarik.webp" alt="Ярик Барабанов">
      <div class="cast-name">ЯРИК БАРАБАНОВ</div>
      <div class="cast-desc">18 лет. Обливает людей компотом, путает получателей голосовых, в остальном — обаятельный катастрофист.</div>
    </div>
    <div class="cast-card">
      <img src="assets/erika.webp" alt="Эрика Криводубская">
      <div class="cast-name">ЭРИКА КРИВОДУБСКАЯ</div>
      <div class="cast-desc">18 лет. Решает пределы первой, грызёт колпачок ручки, ведёт «архив позора» Барабанова на катке.</div>
    </div>
  </div>
</section>

<main class="story">
${chapterSections}
</main>

<footer class="outro">
  <div class="outro-mark">&#10047;</div>
  <div class="outro-title">${esc(TITLE)}</div>
  <div class="outro-sub">— конец —</div>
  <a class="back-to-top" href="#top">наверх</a>
</footer>

<script src="script.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html, 'utf-8');
console.log('wrote index.html, chapters:', allChapters.length);
