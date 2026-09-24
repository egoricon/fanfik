const fs = require('fs');
const path = require('path');
const { TITLE, SUBTITLE, CHAPTER_TITLES, raw_scenes, epilogue } = require('./data.js');

function esc(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function blockType(p) {
  if (p.startsWith('—') || p.startsWith('«')) return 'dialogue';
  return 'narration';
}

function renderParagraph(p, idx) {
  const t = blockType(p);
  if (t === 'dialogue') {
    const side = idx % 2 === 0 ? 'left' : 'right';
    return `<div class="bubble ${side}"><p>${esc(p)}</p></div>`;
  }
  return `<div class="cap"><p>${esc(p)}</p></div>`;
}

const allChapters = raw_scenes.map((s, i) => ({
  num: String(i + 1).padStart(2, '0'),
  title: CHAPTER_TITLES[i] || '',
  blocks: s,
}));
allChapters.push({ num: 'EP', title: 'Эпилог', blocks: epilogue, isEpilogue: true });

const chapterSections = allChapters.map(ch => {
  const blocksHtml = ch.blocks.map((p, j) => renderParagraph(p, j)).join('');
  return `
  <section class="chapter${ch.isEpilogue ? ' epilogue' : ''}" id="ch-${ch.num}">
    <div class="chapter-tag"><span class="chnum">${ch.num}</span><span class="chtitle">${esc(ch.title)}</span></div>
    <div class="panels">${blocksHtml}</div>
  </section>`;
}).join('\n');

const nav = allChapters.map(ch =>
  `<a href="#ch-${ch.num}">${ch.num === 'EP' ? 'Эпилог' : ch.num + '. ' + esc(ch.title)}</a>`
).join('');

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(TITLE)}</title>
<meta name="description" content="${esc(SUBTITLE)}">
<style>
:root{
  --bg:#f4f1ea; --ink:#1a1a1a; --paper:#fff; --accent:#c0392b; --muted:#777;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--ink);
  font-family:Georgia,"Noto Serif",serif;
  line-height:1.5;
}
a{color:inherit}

/* ---- HERO / COVER ---- */
.hero{
  position:relative; min-height:100vh; background:#0c0c0c; color:#f4f1ea;
  display:flex; flex-direction:column; overflow:hidden;
}
.hero-kicker{
  position:relative; z-index:3; text-align:center; padding:20px 12px 0;
  font-family:Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:2px;
  text-transform:uppercase; color:#cfc9ba; opacity:.85;
}
.hero-images{ position:relative; flex:1; display:flex; min-height:60vh; }
.hero-img{ width:50%; height:100%; object-fit:cover; }
.hero-img.boy{ object-position:50% 15%; filter:grayscale(15%) contrast(1.05); }
.hero-img.girl{ object-position:50% 25%; filter:grayscale(10%) contrast(1.05); }
.hero-images::after{
  content:""; position:absolute; left:50%; top:0; bottom:0; width:3px;
  background:var(--accent); transform:translateX(-1.5px);
  box-shadow:0 0 16px 3px rgba(192,57,43,.6);
}
.hero::before{
  content:""; position:absolute; inset:0; z-index:2; pointer-events:none;
  background:linear-gradient(180deg, rgba(0,0,0,.1) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,.55) 75%, rgba(0,0,0,.95) 100%);
}
.hero-title-wrap{ position:relative; z-index:3; text-align:center; padding:0 16px 36px; }
.hero-title{ margin:0; font-size:clamp(28px,6vw,52px); font-weight:700; text-shadow:0 2px 18px rgba(0,0,0,.8); }
.hero-sub{ margin-top:10px; font-family:Helvetica,Arial,sans-serif; font-size:13px; color:#d8d2c4; max-width:560px; margin-left:auto; margin-right:auto; }
.scroll-hint{ position:relative; z-index:3; text-align:center; padding-bottom:18px; font-family:Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#a9a296; }

/* ---- NAV ---- */
.toc{
  max-width:720px; margin:0 auto; padding:28px 16px;
  display:flex; flex-wrap:wrap; gap:8px 14px; justify-content:center;
  font-family:Helvetica,Arial,sans-serif; font-size:12px;
}
.toc a{ text-decoration:none; border-bottom:1px solid transparent; color:#444; }
.toc a:hover{ border-color:var(--accent); color:var(--accent); }

/* ---- CAST ---- */
.cast{ max-width:720px; margin:0 auto; padding:10px 16px 40px; }
.cast-grid{ display:flex; gap:16px; flex-wrap:wrap; }
.cast-card{ flex:1 1 240px; border:1.5px solid var(--ink); background:var(--paper); }
.cast-card img{ width:100%; height:320px; object-fit:cover; filter:grayscale(20%); display:block; border-bottom:1.5px solid var(--ink); }
.cast-name{ font-family:Helvetica,Arial,sans-serif; font-weight:700; font-size:14px; letter-spacing:1px; padding:12px 12px 4px; }
.cast-desc{ font-family:Helvetica,Arial,sans-serif; font-size:12.5px; line-height:1.55; padding:0 12px 14px; color:#333; }

/* ---- CHAPTERS ---- */
.story{ max-width:720px; margin:0 auto; padding:0 16px 60px; }
.chapter{ padding-top:48px; scroll-margin-top:16px; }
.chapter-tag{
  display:flex; align-items:baseline; gap:12px;
  border-bottom:1.5px solid var(--ink); padding-bottom:8px; margin-bottom:18px;
  font-family:Helvetica,Arial,sans-serif;
}
.chnum{ font-size:26px; font-weight:800; color:var(--accent); }
.chtitle{ font-size:13px; letter-spacing:2px; text-transform:uppercase; }
.panels{ display:flex; flex-direction:column; gap:14px; }
.cap{ border:1px solid var(--ink); background:var(--paper); padding:12px 16px; box-shadow:4px 4px 0 rgba(0,0,0,.06); }
.cap p{ margin:0; font-size:15px; line-height:1.6; }
.bubble{
  max-width:82%; border:1.5px solid var(--ink); border-radius:18px; background:var(--paper);
  padding:12px 18px; box-shadow:3px 3px 0 rgba(0,0,0,.05);
}
.bubble p{ margin:0; font-size:15px; line-height:1.55; font-style:italic; }
.bubble.left{ align-self:flex-start; border-bottom-left-radius:3px; }
.bubble.right{ align-self:flex-end; border-bottom-right-radius:3px; text-align:right; }
.epilogue .chnum{ color:var(--ink); }

/* ---- FOOTER ---- */
.outro{
  background:#0c0c0c; color:#f4f1ea; text-align:center; padding:70px 16px;
}
.outro-mark{ font-size:28px; color:var(--accent); margin-bottom:14px; }
.outro-title{ font-size:18px; letter-spacing:1px; }
.outro-sub{ margin-top:8px; font-family:Helvetica,Arial,sans-serif; font-size:11px; letter-spacing:3px; color:#a9a296; text-transform:uppercase; }
.back-to-top{
  display:inline-block; margin-top:26px; font-family:Helvetica,Arial,sans-serif; font-size:11px;
  letter-spacing:1px; color:#cfc9ba; text-decoration:none; border:1px solid #4a4a4a; padding:8px 16px; border-radius:20px;
}
.back-to-top:hover{ border-color:var(--accent); color:var(--accent); }

@media (max-width:520px){
  .hero-images{ min-height:50vh; }
  .cast-card img{ height:260px; }
  .bubble{ max-width:92%; }
}
</style>
</head>
<body>

<header class="hero" id="top">
  <div class="hero-kicker">ИЭФ БГУИР · Электронная экономика · Первый курс</div>
  <div class="hero-images">
    <img class="hero-img boy" src="assets/yarik.webp" alt="Ярик Барабанов">
    <img class="hero-img girl" src="assets/erika.webp" alt="Эрика Криводубская">
  </div>
  <div class="hero-title-wrap">
    <h1 class="hero-title">${esc(TITLE)}</h1>
    <div class="hero-sub">${esc(SUBTITLE)}</div>
  </div>
  <div class="scroll-hint">листай вниз ↓</div>
</header>

<nav class="toc">${nav}</nav>

<section class="cast">
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

</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), html, 'utf-8');
console.log('wrote index.html, chapters:', allChapters.length);
