(function () {
  'use strict';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reading progress bar
  var bar = document.getElementById('progress');
  function updateProgress() {
    var h = document.documentElement;
    var scrollTop = h.scrollTop || document.body.scrollTop;
    var height = h.scrollHeight - h.clientHeight;
    var pct = height > 0 ? (scrollTop / height) * 100 : 0;
    if (bar) bar.style.width = pct + '%';
  }

  // Hero parallax
  var heroImages = document.getElementById('heroImages');
  var hero = document.getElementById('top');
  function updateParallax() {
    if (reduceMotion || !heroImages || !hero) return;
    var rect = hero.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;
    var offset = window.scrollY * 0.28;
    heroImages.style.transform = 'translateY(' + offset + 'px)';
  }

  var ticking = false;
  function onScroll() {
    if (!ticking) {
      window.requestAnimationFrame(function () {
        updateProgress();
        updateParallax();
        ticking = false;
      });
      ticking = true;
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  updateProgress();
  updateParallax();

  // Scroll-reveal
  if ('IntersectionObserver' in window) {
    var revealTargets = document.querySelectorAll('[data-reveal], .chapter-tag');
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    );
    revealTargets.forEach(function (el) {
      io.observe(el);
    });

    // Staggered delay within each .panels group
    document.querySelectorAll('.panels').forEach(function (group) {
      var i = 0;
      group.querySelectorAll('[data-reveal]').forEach(function (el) {
        el.style.transitionDelay = Math.min(i * 60, 300) + 'ms';
        i++;
      });
    });
  } else {
    document.querySelectorAll('[data-reveal], .chapter-tag').forEach(function (el) {
      el.classList.add('is-visible');
    });
  }

  // Decorative floating petals in hero
  var petalLayer = document.getElementById('petals');
  if (petalLayer && !reduceMotion) {
    var n = 9;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('span');
      p.className = 'petal';
      var left = Math.random() * 100;
      var dur = 9 + Math.random() * 8;
      var delay = Math.random() * 10;
      var dx = (Math.random() * 80 - 40).toFixed(0) + 'px';
      p.style.left = left + '%';
      p.style.setProperty('--dx', dx);
      p.style.animationDuration = dur + 's';
      p.style.animationDelay = delay + 's';
      p.style.width = p.style.height = (6 + Math.random() * 6).toFixed(0) + 'px';
      petalLayer.appendChild(p);
    }
  }
})();
