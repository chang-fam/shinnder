/* =========================================================
   Memorial site — vanilla JS
   - Fade-in on scroll (used in tributes/photos panels)
   - Language toggle (EN / 中文)
   - Top-level tab switching (In Memoriam / Atlas / Tributes / Photos)
   - Atlas: chapter pager (no map; click pills or arrows)
   ========================================================= */

(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------- Fade-in on scroll ----------------
  const faders = document.querySelectorAll('.fade-in');
  if ('IntersectionObserver' in window && !reduced) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    faders.forEach((el) => io.observe(el));
  } else {
    faders.forEach((el) => el.classList.add('is-visible'));
  }

  // ---------------- Language toggle ----------------
  const STORAGE_KEY = 'memorial-lang';
  const validLangs = ['en', 'zh'];

  function getSavedLang() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (validLangs.includes(v)) return v;
    } catch (_) {}
    return 'en';
  }

  function setLang(lang) {
    if (!validLangs.includes(lang)) lang = 'en';
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (_) {}

    document.querySelectorAll('[data-en], [data-zh]').forEach((el) => {
      const txt = el.getAttribute('data-' + lang);
      if (txt == null) return;
      // Use innerHTML so translations can contain inline markup
      // (e.g. <em>, <strong>) for the eulogies. Static, author-controlled
      // content — no XSS surface.
      el.innerHTML = txt;
    });
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.lang === lang ? 'true' : 'false');
    });
    // Notify any registered listeners (e.g. atlas map labels) about lang change
    document.dispatchEvent(new CustomEvent('lang:changed', { detail: { lang } }));
  }

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });
  setLang(getSavedLang());

  // ---------------- Top-level tab switching ----------------
  const TAB_KEY = 'memorial-tab';
  const validTabs = ['memoriam', 'atlas', 'tributes', 'photos'];
  const tabBtns = Array.from(document.querySelectorAll('.topnav-tab'));
  const tabViews = Array.from(document.querySelectorAll('.tab-view'));

  function getSavedTab() {
    try {
      const v = localStorage.getItem(TAB_KEY);
      if (validTabs.includes(v)) return v;
    } catch (_) {}
    return 'memoriam';
  }

  function setActiveTab(name, opts) {
    opts = opts || {};
    if (!validTabs.includes(name)) name = 'memoriam';
    tabBtns.forEach(b => {
      const on = b.dataset.tab === name;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    tabViews.forEach(v => {
      v.classList.toggle('is-active', v.dataset.tab === name);
    });
    try { localStorage.setItem(TAB_KEY, name); } catch (_) {}
    // Reset internal scroll for tributes/photos when switching in
    if (!opts.silent) {
      const v = tabViews.find(v => v.dataset.tab === name);
      if (v) v.scrollTop = 0;
      // Also reset window scroll so the bridge footer collapses
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    }
  }

  tabBtns.forEach(b => {
    b.addEventListener('click', () => setActiveTab(b.dataset.tab));
  });
  setActiveTab(getSavedTab(), { silent: true });

  // ============================================================
  // ATLAS — chapter pager (no map)
  // ============================================================
  const atlas = document.querySelector('.tab-view[data-tab="atlas"]');
  if (!atlas) return;

  const CHAPTER_TITLES = {
    en: [
      'A restaurant on Nan Jie',
      'Four hundred kilometres inland',
      'A load of textiles, and a love',
      'Climbing the towers',
      '$145 a month',
      'Two inches, not four-and-a-quarter',
      'Twenty winters in the garden',
    ],
    zh: [
      '南街上的一家餐館',
      '遷徙四百公里',
      '一擔布疋　一段情',
      '攀上高塔',
      '每月一百四十五元',
      '兩英吋　而非四又四分之一',
      '園中二十寒暑',
    ],
  };

  const frame = atlas.querySelector('.atlas-frame');
  const chapterEls = Array.from(atlas.querySelectorAll('.ach'));
  const idxBtns = Array.from(atlas.querySelectorAll('.atlas-idx'));
  const prevBtn = atlas.querySelector('.atlas-prev');
  const nextBtn = atlas.querySelector('.atlas-next');
  const totalCh = chapterEls.length;
  const mapEl   = atlas.querySelector('.atlas-map');
  const cityLabel = atlas.querySelector('.atlas-map-city');
  const regionLabel = atlas.querySelector('.atlas-map-region');

  // ============================================================
  //  MAP rendering — build SVGs from window.__MAPS, place pins per chapter
  // ============================================================
  const MAPS = window.__MAPS || {};
  // Bounding boxes calibrated against actual province path centroids
  // (CN-11 Beijing, CN-44 Guangdong, CN-31 Shanghai for china;
  //  CA-AB, CA-NS for canada). Equirectangular approximation.
  const REGION_BBOX = {
    china:  { lonMin: 75.35, lonMax: 133.91, latMin: 18.84, latMax: 56.11 },
    taiwan: { lonMin: 118.0, lonMax: 122.6,  latMin: 21.5,  latMax: 26.4  },
    canada: { lonMin: -141,  lonMax: -52,    latMin: 41,    latMax: 84    },
  };
  // Optional viewBox cropping per region — zoom into the area relevant
  // to this story. Coords are in source-SVG space (post-projection).
  const REGION_VIEWBOX = {
    china:  { x: 525, y: 405, w: 100, h: 130 },  // SE China + Taiwan (Fujian + TW)
    canada: { x: 460, y: 800, w: 290, h: 220 },  // Eastern Canada (ON + QC + Maritimes)
  };
  // Hand-calibrated pin positions in source-SVG coords, derived from each
  // map's intrinsic projection rather than a single equirectangular fit:
  //   • Fujian cities use the Fujian path bbox (CN-35) as calibration:
  //     x scale 13.3 SVG/°lon, y scale 15.5 SVG/°lat, anchored to centroid
  //     (563.67, 463.01) at (~118°E, 26°N)
  //   • Taiwan cities use the Taiwan path bbox (CN-71) as calibration:
  //     x scale 23.6 SVG/°lon, y scale 13.8 SVG/°lat (Taiwan is drawn at a
  //     different scale than the mainland in this SVG)
  //   • Canada cities use the ON ↔ NS centroid line for calibration:
  //     x scale 8.86 SVG/°lon, y scale 12.19 SVG/°lat
  const PIN_POS = {
    // SE China + Taiwan. Pin coords are picked to land on the actual landmass:
    // sampled the Fujian (CN-35) and Taiwan (CN-71) path bounds at each
    // city's latitude, then placed each pin just inside the appropriate shore.
    'Fuzhou':          { region: 'china', x: 580, y: 460 },  // east coast of Fujian, mouth of the Min River
    'Nanping':         { region: 'china', x: 566, y: 453 },  // NW Fujian, inland on the Min River
    'Taipei':          { region: 'china', x: 605, y: 476 },  // N Taiwan (Taipei basin) — Taiwan x range at y=476 is 600–612
    'Kaohsiung':       { region: 'china', x: 591, y: 509 },  // SW Taiwan, west coast — Taiwan x range at y=509 is 590–602
    // Eastern Canada
    'Ottawa':          { region: 'canada', x: 581, y: 982 },  // E Ontario, on the Ottawa River
    'Toronto':         { region: 'canada', x: 558, y: 1004 }, // S Ontario, Lake Ontario shore near Hamilton/Mississauga
    'Port Hawkesbury': { region: 'canada', x: 718, y: 980 },  // Cape Breton, between PEI to the north and the strait
  };

  function buildMapSvg(region) {
    const data = MAPS[region];
    const svgEl = atlas.querySelector('.atlas-map-svg[data-which="' + region + '"]');
    if (!data || !svgEl) return;
    const vb = REGION_VIEWBOX[region];
    const vbStr = vb
      ? `${vb.x} ${vb.y} ${vb.w} ${vb.h}`
      : `0 0 ${data.w} ${data.h}`;
    svgEl.setAttribute('viewBox', vbStr);
    svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svgEl.innerHTML = data.paths.map(p =>
      '<path class="atlas-land" d="' + p.d + '" data-id="' + p.id + '"></path>'
    ).join('');
    // Mirror viewBox onto the trail + pins layers so everything shares one
    // coord system. (Without this, the HTML overlay of pins drifts ~40px
    // away from the SVG content because the SVG is letterboxed by
    // preserveAspectRatio="meet".)
    ['trail', 'pins'].forEach(layer => {
      const el = atlas.querySelector('.atlas-map-' + layer + '[data-which="' + region + '"]');
      if (el) {
        el.setAttribute('viewBox', vbStr);
        el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      }
    });
  }

  function projectToSvg(region, lon, lat) {
    const bb = REGION_BBOX[region];
    const data = MAPS[region];
    if (!bb || !data) return null;
    const x = (lon - bb.lonMin) / (bb.lonMax - bb.lonMin) * data.w;
    const y = (1 - (lat - bb.latMin) / (bb.latMax - bb.latMin)) * data.h;
    return { x, y };
  }

  function renderPins() {
    atlas.querySelectorAll('.atlas-map-pins').forEach(p => p.innerHTML = '');
    const SVG_NS = 'http://www.w3.org/2000/svg';
    chapterEls.forEach((ch, i) => {
      const city = ch.dataset.city;
      const fixed = PIN_POS[city];
      let region, pt;
      if (fixed) {
        region = fixed.region;
        pt = { x: fixed.x, y: fixed.y };
      } else {
        region = ch.dataset.region;
        const coords = ch.dataset.coords;
        if (!region || !coords) return;
        const [lon, lat] = coords.split(',').map(Number);
        if (!MAPS[region]) return;
        pt = projectToSvg(region, lon, lat);
        if (!pt) return;
      }
      const data = MAPS[region];
      if (!data) return;
      const layer = atlas.querySelector('.atlas-map-pins[data-which="' + region + '"]');
      if (!layer) return;
      const vb = REGION_VIEWBOX[region] || { x: 0, y: 0, w: data.w, h: data.h };
      // Cull anything outside the visible viewBox
      if (pt.x < vb.x - 2 || pt.x > vb.x + vb.w + 2 || pt.y < vb.y - 2 || pt.y > vb.y + vb.h + 2) return;

      // Pin sizes scaled to viewBox so rendered pixel size is consistent
      // across regions.
      const dotR  = vb.w * 0.013;
      const ringR = vb.w * 0.022;

      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'amp-pin');
      g.dataset.chapter = String(i);
      g.setAttribute('aria-label', 'Chapter ' + (i + 1) + ' · ' + (city || ''));

      // Outer pulse ring (only visible on active pin)
      const ring = document.createElementNS(SVG_NS, 'circle');
      ring.setAttribute('class', 'amp-ring');
      ring.setAttribute('cx', pt.x);
      ring.setAttribute('cy', pt.y);
      ring.setAttribute('r', ringR);
      g.appendChild(ring);

      // Diamond marker — small rotated square, more refined than a plain dot
      const dot = document.createElementNS(SVG_NS, 'polygon');
      dot.setAttribute('class', 'amp-dot');
      const r = dotR;
      dot.setAttribute('points',
        `${pt.x},${pt.y - r} ${pt.x + r},${pt.y} ${pt.x},${pt.y + r} ${pt.x - r},${pt.y}`
      );
      g.appendChild(dot);

      g.addEventListener('click', () => setChapter(i));
      layer.appendChild(g);
    });
  }

  if (MAPS && Object.keys(MAPS).length) {
    ['china', 'taiwan', 'canada'].forEach(buildMapSvg);
    renderPins();
  }

  const REGION_NAMES = {
    en: { china: 'China', taiwan: 'Taiwan', canada: 'Canada' },
    zh: { china: '中國',  taiwan: '臺灣',    canada: '加拿大' },
  };

  function updateMapForChapter(idx) {
    const ch = chapterEls[idx];
    if (!ch) return;
    const region = ch.dataset.region;
    // Display region for the LABEL can differ from the SVG region — e.g.
    // Taipei/Kaohsiung render on the China SVG (which includes Taiwan as
    // CN-71) but the label should still read "Taiwan".
    const displayRegion = ch.dataset.displayRegion || region;
    const city = ch.dataset.city || '';
    if (mapEl && region) mapEl.dataset.activeRegion = region;
    atlas.querySelectorAll('.amp-pin').forEach(p => {
      p.classList.toggle('is-active', Number(p.dataset.chapter) === idx);
    });
    const lang = document.documentElement.getAttribute('data-lang') || 'en';
    if (regionLabel) regionLabel.textContent = (REGION_NAMES[lang] && REGION_NAMES[lang][displayRegion]) || '';
    if (cityLabel) cityLabel.textContent = city;
  }

  let activeIdx = 0;

  // Animate a small triangle traveling along a curved arc from the previous
  // chapter pin to the new one. No visible line — the triangle's motion alone
  // is the journey. (The user found the dashed line distracting.)
  // The path element is rendered without stroke; we use it only for
  // getPointAtLength() to drive the triangle's position and rotation.
  function drawTrail(prevIdx, newIdx) {
    if (reduced) return;
    if (prevIdx == null || prevIdx === newIdx) return;
    const prevCh = chapterEls[prevIdx];
    const newCh  = chapterEls[newIdx];
    if (!prevCh || !newCh) return;
    const prevPos = PIN_POS[prevCh.dataset.city];
    const newPos  = PIN_POS[newCh.dataset.city];
    if (!prevPos || !newPos) return;
    if (prevPos.region !== newPos.region) return;
    const trail = atlas.querySelector('.atlas-map-trail[data-which="' + newPos.region + '"]');
    if (!trail) return;

    const dx = newPos.x - prevPos.x;
    const dy = newPos.y - prevPos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    const mx = (prevPos.x + newPos.x) / 2;
    const my = (prevPos.y + newPos.y) / 2;
    const perpX = -dy / dist;
    const perpY =  dx / dist;
    const bow = Math.max(4, dist * 0.16);
    const ctrlX = mx + perpX * bow;
    const ctrlY = my + perpY * bow;
    const d = `M ${prevPos.x} ${prevPos.y} Q ${ctrlX} ${ctrlY} ${newPos.x} ${newPos.y}`;

    const vbW = (REGION_VIEWBOX[newPos.region] || { w: data.w }).w;
    const arrowSize = vbW * 0.013;
    const aw = arrowSize * 1.5;
    const ah = arrowSize;
    trail.innerHTML =
      // Invisible path — used only as the geometric track for the triangle.
      // fill="none" is set inline because <path> defaults to fill="black",
      // and CSS class rules don't always apply to elements created via
      // innerHTML on SVG elements (namespace quirk).
      `<path class="trail-path-track" d="${d}" fill="none" stroke="none" />` +
      // The triangle traveler — single visible element
      `<polygon class="trail-arrow" points="${-aw*0.55},${-ah*0.55} ${aw*0.65},0 ${-aw*0.55},${ah*0.55}" />`;

    const track = trail.querySelector('.trail-path-track');
    const arrow = trail.querySelector('.trail-arrow');
    const len  = track.getTotalLength();

    const drawMs   = Math.max(900, Math.min(1600, 600 + dist * 10));
    const holdMs   = 250;
    const fadeOutMs = 500;
    const fadeInMs = Math.min(220, drawMs * 0.2);

    arrow.style.opacity = '0';
    arrow.style.transition = 'none';
    arrow.getBoundingClientRect();

    requestAnimationFrame(() => {
      arrow.style.transition = `opacity ${fadeInMs}ms ease-out`;
      arrow.style.opacity = '1';
    });

    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / drawMs);
      const e = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const visible = e * len;

      const head = track.getPointAtLength(visible);
      const back = track.getPointAtLength(Math.max(0, visible - 1.2));
      const ang = Math.atan2(head.y - back.y, head.x - back.x) * 180 / Math.PI;
      arrow.setAttribute('transform', `translate(${head.x} ${head.y}) rotate(${ang})`);

      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    setTimeout(() => {
      if (!arrow.parentElement) return;
      arrow.style.transition = `opacity ${fadeOutMs}ms ease-in`;
      arrow.style.opacity = '0';
    }, drawMs + holdMs);

    setTimeout(() => { trail.innerHTML = ''; }, drawMs + holdMs + fadeOutMs + 50);
  }

  function setChapter(idx, opts) {
    opts = opts || {};
    idx = Math.max(0, Math.min(totalCh - 1, idx));
    const prevIdx = activeIdx;
    activeIdx = idx;

    if (frame) frame.dataset.activeChapter = String(idx);

    chapterEls.forEach((el, i) => {
      el.classList.toggle('is-active', i === idx);
    });
    idxBtns.forEach((btn, i) => {
      btn.classList.toggle('is-active', i === idx);
      btn.classList.toggle('is-past', i < idx);
    });
    if (prevBtn) prevBtn.disabled = idx === 0;
    if (nextBtn) nextBtn.disabled = idx === totalCh - 1;

    updateMapForChapter(idx);

    if (!opts.silent) drawTrail(prevIdx, idx);

    // Reset chapter scroll
    const stack = atlas.querySelector('.atlas-chapters');
    if (stack && !opts.silent) stack.scrollTop = 0;
  }

  idxBtns.forEach(btn => {
    btn.addEventListener('click', () => setChapter(Number(btn.dataset.chapter)));
  });
  if (prevBtn) prevBtn.addEventListener('click', () => setChapter(activeIdx - 1));
  if (nextBtn) nextBtn.addEventListener('click', () => setChapter(activeIdx + 1));

  // Keyboard ←/→ when atlas tab is active
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!atlas.classList.contains('is-active')) return;
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA'].includes(active.tagName)) return;
    e.preventDefault();
    if (e.key === 'ArrowRight') setChapter(activeIdx + 1);
    else setChapter(activeIdx - 1);
  });

  setChapter(0, { silent: true });

  // Refresh region label when language changes
  document.addEventListener('lang:changed', () => updateMapForChapter(activeIdx));

  // ============================================================
  // BRIDGE FOOTER — image carousel (6 styles)
  // Driven by keyboard ←/→ on desktop, swipe ←/→ on touch. No on-image
  // controls — the painting is meant to speak for itself.
  // ============================================================
  const bridgeFooter = document.querySelector('.bridge-footer');
  if (bridgeFooter) {
    const slides = Array.from(bridgeFooter.querySelectorAll('.bridge-bg-img'));
    let bridgeIdx = 0;
    function setBridgeStyle(i) {
      const n = slides.length;
      if (n === 0) return;
      bridgeIdx = ((i % n) + n) % n;
      slides.forEach((s, idx) => s.classList.toggle('is-active', idx === bridgeIdx));
    }
    function bridgeIsInView(thresh) {
      const rect = bridgeFooter.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const visible = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      return visible / vh >= thresh;
    }

    // Keyboard arrows — only when the bridge footer is meaningfully visible
    // and the user isn't typing in an input. Atlas chapter arrows take
    // precedence (they call preventDefault first when Atlas is the active tab).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const ae = document.activeElement;
      if (ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return;
      if (e.defaultPrevented) return;
      if (!bridgeIsInView(0.35)) return;
      e.preventDefault();
      setBridgeStyle(bridgeIdx + (e.key === 'ArrowRight' ? 1 : -1));
    });

    // Touch swipe — left to advance, right to retreat. Threshold guards
    // against accidental brushes; angle guard ignores mostly-vertical drags
    // so the user can still scroll past the footer.
    const SWIPE_MIN_PX = 45;
    const SWIPE_MAX_VERT_RATIO = 0.7;  // |dy| / |dx| must be < this
    let tStartX = null, tStartY = null, tStartT = 0;
    bridgeFooter.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { tStartX = null; return; }
      const t = e.touches[0];
      tStartX = t.clientX;
      tStartY = t.clientY;
      tStartT = e.timeStamp;
    }, { passive: true });
    bridgeFooter.addEventListener('touchend', (e) => {
      if (tStartX == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - tStartX;
      const dy = t.clientY - tStartY;
      const dt = e.timeStamp - tStartT;
      tStartX = tStartY = null;
      if (dt > 800) return;                            // too slow → not a swipe
      if (Math.abs(dx) < SWIPE_MIN_PX) return;          // too short
      if (Math.abs(dy) / Math.abs(dx) > SWIPE_MAX_VERT_RATIO) return;  // mostly vertical → ignore
      setBridgeStyle(bridgeIdx + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }

})();

/* =========================================================
   TRIBUTE PICKER — horizontal selector controller
   ========================================================= */
(function () {
  'use strict';
  const picker = document.querySelector('.tribute-picker');
  if (!picker) return;

  const chips = Array.from(picker.querySelectorAll('.tribute-chip'));
  const stack = document.querySelector('.tribute-stack');
  if (!stack) return;
  const letters = Array.from(stack.querySelectorAll('.letter'));

  function selectTribute(targetId) {
    chips.forEach((c) => {
      const on = c.dataset.target === targetId;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    letters.forEach((l) => {
      const on = l.id === targetId;
      l.classList.toggle('is-active', on);
      if (on) {
        l.removeAttribute('hidden');
      } else {
        l.setAttribute('hidden', '');
      }
    });
    // Reset the tributes scroll so the newly-shown letter starts at the top.
    const tabView = document.querySelector('.tab-view[data-tab="tributes"]');
    if (tabView) {
      const head = document.querySelector('#tributes-section .section-head');
      if (head) {
        const rect = head.getBoundingClientRect();
        const tvRect = tabView.getBoundingClientRect();
        // only auto-scroll if the picker is scrolled out of view above the user
        if (rect.bottom < tvRect.top) tabView.scrollTop = 0;
      }
    }
  }

  chips.forEach((c) => {
    c.addEventListener('click', () => selectTribute(c.dataset.target));
    // Keyboard arrow nav across the tablist
    c.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = chips.indexOf(c);
      const next = e.key === 'ArrowRight' ? (i + 1) % chips.length : (i - 1 + chips.length) % chips.length;
      chips[next].focus();
      selectTribute(chips[next].dataset.target);
    });
  });
})();


/* =========================================================
   DONGGUA RAIL controller
   - Watercolor vine + spigot painted into the .vine-art image.
   - On click of the spigot: spawn drops, splashes (+ sound),
     shake the melon, advance growth stage 0..3, then auto-fall
     and bump the 冬瓜 GROWN counter.
   - Each completed grow also posts to the Cloudflare Worker so the
     global count + "Tended by" roster reflect everyone, not just this
     visitor. Falls back to local-only counting if the worker is
     unreachable (offline, blocked, or COUNTER_API not yet wired up).
   - Self-contained IIFE; safe no-op if the rail isn't on the page.
   ========================================================= */
(function () {
  'use strict';

  // Worker endpoint. Set to '' to disable remote state entirely.
  // After `npx wrangler deploy`, replace with the printed URL, e.g.
  // 'https://donggua-counter.<your-handle>.workers.dev'.
  const COUNTER_API = 'https://donggua-counter.yuedaniel.workers.dev';

  const stage      = document.getElementById('vineStage');
  if (!stage) return;
  const melon      = document.getElementById('melonStage');
  const waterFx    = document.getElementById('waterFx');
  const splashFx   = document.getElementById('splashFx');
  const counterNum = document.getElementById('counterNum');
  const spigotBtn  = stage.querySelector('.ctrl-spigot');
  const nameInput  = document.getElementById('growerName');
  const rosterEl   = document.querySelector('.grower-roster');
  const rosterList = document.getElementById('growerList');
  if (!melon || !waterFx || !splashFx || !counterNum || !spigotBtn) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const STAGE_BASE_SCALES = { 0: 0.25, 1: 0.44, 2: 0.72, 3: 1.00 };
  const STAGE_IMAGES = {
    1: 'images/donggua-base1.png',
    2: 'images/donggua-base2.png',
    3: 'images/donggua-base3.png',
  };
  const MAX_STAGE = 3;
  const DROP_TRAVEL_MS = 980;
  const SPLASH_MS = 1400;
  const GROWTH_AFTER_SPLASH_MS = 1000;
  const SPLASH_OFFSET_X = 15;
  const DROP_STAGGER_MS = 180;
  const DROP_COUNT = 3;
  const MELON_SHAKE_MS = 260;
  const SPLASH_SOUND_RATE = { min: 0.7, max: 1.08 };

  // Coordinates inside the FX SVG (1024×1536, matches vine-art image).
  const SPOUT  = { x: 650, y: 170  };
  const DROPLET_TARGET_X_RANGE = { min: 500, max: 700 };
  const DROPLET_TARGET_Y_RANGE = { min: 1260, max: 1450 };

  let currentStage = 0;
  let grown = 0;
  let busy = false;
  let stageScales = { ...STAGE_BASE_SCALES };

  // Roster pagination + fair-ordering state. See syncRoster / renderRoster.
  const ROSTER_PAGE_SIZE = 6;
  let rosterEntries = [];   // growers in their established display order
  let rosterPage = 0;
  let rosterPinKey = null;  // visitor's own name, kept pinned to the top
  let rosterNav = null;     // lazily-built prev/next control

  const splashSound = new Audio('assets/water-drop.wav');
  splashSound.preload = 'auto';

  const randomBetween = (min, max) => min + Math.random() * (max - min);
  const clampN = (v, min, max) => Math.min(max, Math.max(min, v));
  const randomTarget = () => ({
    x: randomBetween(DROPLET_TARGET_X_RANGE.min, DROPLET_TARGET_X_RANGE.max),
    y: randomBetween(DROPLET_TARGET_Y_RANGE.min, DROPLET_TARGET_Y_RANGE.max),
  });

  function playSplashSound() {
    const hit = splashSound.cloneNode();
    hit.volume = 0.08;
    hit.playbackRate = randomBetween(SPLASH_SOUND_RATE.min, SPLASH_SOUND_RATE.max);
    hit.play().catch(() => {});
  }

  function rollStageScales() {
    const cycle = randomBetween(0.82, 1.22);
    const s1 = clampN(STAGE_BASE_SCALES[1] * cycle * randomBetween(0.9, 1.1), 0.34, 0.68);
    const s2 = clampN(Math.max(s1 + 0.16, STAGE_BASE_SCALES[2] * cycle * randomBetween(0.92, 1.12)), s1 + 0.16, 1.0);
    const s3 = clampN(Math.max(s2 + 0.18, STAGE_BASE_SCALES[3] * cycle * randomBetween(0.94, 1.15)), s2 + 0.18, 1.35);
    stageScales = {
      0: STAGE_BASE_SCALES[0],
      1: Number(s1.toFixed(3)),
      2: Number(s2.toFixed(3)),
      3: Number(s3.toFixed(3)),
    };
  }

  function setStage(s) {
    currentStage = s;
    melon.setAttribute('data-stage', String(s));
    if (STAGE_IMAGES[s]) melon.src = STAGE_IMAGES[s];
    melon.style.setProperty('--scale', stageScales[s]);
  }

  function bumpCounter() {
    grown += 1;
    counterNum.textContent = String(grown);
    counterNum.classList.add('is-bumped');
    setTimeout(() => counterNum.classList.remove('is-bumped'), 400);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Fisher–Yates shuffle (returns a new array).
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Normalize a name to a stable key — mirrors the worker's sanitize
  // (collapse whitespace, case-fold) so the visitor's own entry matches.
  function rosterKey(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Reconcile a fresh list of growers from the worker into the display
  // order held in `rosterEntries`.
  //   opts.shuffle  — page load: randomize the whole roster so no one is
  //                   perpetually listed first ("promote equivalence").
  //   opts.pinName  — the visitor just grew one under this name: keep it
  //                   pinned to the top, for them, this session.
  // Between those two events the order is held stable: counts refresh in
  // place, brand-new names are shuffled in at the end, vanished names
  // drop out — so the roster doesn't reshuffle under the reader on every
  // grow.
  function syncRoster(growers, opts) {
    opts = opts || {};
    const list = Array.isArray(growers) ? growers : [];
    const byKey = new Map(list.map((g) => [rosterKey(g.name), g]));
    if (opts.pinName) rosterPinKey = rosterKey(opts.pinName);

    if (opts.shuffle) {
      rosterEntries = shuffled(list);
    } else {
      const seen = new Set();
      const kept = [];
      for (const e of rosterEntries) {
        const k = rosterKey(e.name);
        const fresh = byKey.get(k);
        if (fresh && !seen.has(k)) { kept.push(fresh); seen.add(k); }
      }
      const added = shuffled(list.filter((g) => !seen.has(rosterKey(g.name))));
      rosterEntries = kept.concat(added);
    }

    if (rosterPinKey) {
      const idx = rosterEntries.findIndex((e) => rosterKey(e.name) === rosterPinKey);
      if (idx > 0) {
        const [mine] = rosterEntries.splice(idx, 1);
        rosterEntries.unshift(mine);
      }
    }

    if (opts.pinName) rosterPage = 0;   // jump to the page with their name
    renderRoster();
  }

  // Build / refresh the prev–next control. Hidden when one page or fewer.
  function renderRosterNav(pageCount) {
    if (!rosterList) return;
    if (pageCount <= 1) {
      if (rosterNav) rosterNav.hidden = true;
      return;
    }
    if (!rosterNav) {
      rosterNav = document.createElement('div');
      rosterNav.className = 'grower-roster-nav';
      rosterNav.innerHTML =
        '<button type="button" class="grower-roster-arrow" data-dir="-1" ' +
        'aria-label="Previous names">‹</button>' +
        '<span class="grower-roster-page" aria-live="polite"></span>' +
        '<button type="button" class="grower-roster-arrow" data-dir="1" ' +
        'aria-label="More names">›</button>';
      rosterList.insertAdjacentElement('afterend', rosterNav);
      rosterNav.addEventListener('click', (e) => {
        const btn = e.target.closest('.grower-roster-arrow');
        if (!btn) return;
        const pc = Math.ceil(rosterEntries.length / ROSTER_PAGE_SIZE) || 1;
        rosterPage = (rosterPage + Number(btn.dataset.dir) + pc) % pc;
        renderRoster();
      });
    }
    rosterNav.hidden = false;
    rosterNav.querySelector('.grower-roster-page').textContent =
      (rosterPage + 1) + ' / ' + pageCount;
  }

  // Render the current page of the roster. The roster is hidden via
  // .has-names when empty, which swaps in the "No one yet" line.
  function renderRoster() {
    if (!rosterEl || !rosterList) return;
    if (!rosterEntries.length) {
      rosterEl.classList.remove('has-names');
      rosterList.innerHTML = '';
      if (rosterNav) rosterNav.hidden = true;
      return;
    }
    rosterEl.classList.add('has-names');

    const pageCount = Math.ceil(rosterEntries.length / ROSTER_PAGE_SIZE);
    rosterPage = clampN(rosterPage, 0, pageCount - 1);
    const start = rosterPage * ROSTER_PAGE_SIZE;

    rosterList.innerHTML = rosterEntries
      .slice(start, start + ROSTER_PAGE_SIZE)
      .map((g) => {
        const name = escapeHtml(g.name);
        const count = Number(g.count) || 1;
        return `<li><span class="grower-name">${name}</span>` +
               `<span class="grower-count" data-count="${count}">${count}</span></li>`;
      }).join('');

    renderRosterNav(pageCount);
  }

  async function loadGlobalState() {
    if (!COUNTER_API) return;
    try {
      const r = await fetch(`${COUNTER_API}/state`, { cache: 'no-store' });
      if (!r.ok) return;
      const state = await r.json();
      // Quiet update on first paint — no celebratory pop.
      grown = Number(state.total) || 0;
      counterNum.textContent = String(grown);
      syncRoster(state.growers, { shuffle: true });
    } catch (_) {
      // Network error / blocked / no worker yet — keep local-only counter.
    }
  }

  async function reportGrow() {
    if (!COUNTER_API) {
      // Worker disabled — keep local-only behavior.
      bumpCounter();
      return;
    }
    const name = nameInput ? nameInput.value.trim() : '';
    // Optimistic local bump so the UI reacts immediately even if the
    // network is slow. The server response overwrites with the
    // authoritative total.
    bumpCounter();
    try {
      const r = await fetch(`${COUNTER_API}/grow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) return;
      const state = await r.json();
      // Reconcile: the worker's total is authoritative. Render without
      // re-triggering the pop animation.
      grown = Number(state.total) || grown;
      counterNum.textContent = String(grown);
      syncRoster(state.growers, { pinName: name });
    } catch (_) {
      // Already bumped locally; nothing else to do.
    }
  }

  function spawnDrops(origin, targets) {
    waterFx.innerHTML = '';
    const impacts = [];
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const baseDx = target.x - origin.x;
      const baseDy = target.y - origin.y;
      const drop = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      const jitterX = (Math.random() - 0.5) * 36;
      const jitterY = (Math.random() - 0.2) * 50;
      const size = 42 + Math.random() * 8;
      const startX = origin.x + (Math.random() - 0.5) * 18;
      const startY = origin.y + (Math.random() - 0.5) * 10;
      drop.setAttributeNS(null, 'href', 'images/water-drop.png');
      drop.setAttribute('x', String(startX - size / 2));
      drop.setAttribute('y', String(startY - size / 2));
      drop.setAttribute('width', String(size));
      drop.setAttribute('height', String(size));
      drop.setAttribute('class', 'drop drop-rain');
      drop.style.setProperty('--dx', (baseDx + jitterX) + 'px');
      drop.style.setProperty('--dy', (baseDy + jitterY) + 'px');
      drop.style.animationDelay = (i * 90) + 'ms, ' + ((i * 90) + 230) + 'ms';
      waterFx.appendChild(drop);
      impacts.push({ target, dropSize: size });
    }
    setTimeout(() => {
      waterFx.querySelectorAll('.drop').forEach((d) => d.remove());
    }, 1500 + targets.length * 90);
    return impacts;
  }

  function spawnSplash(target, size, delayMs) {
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    ring.setAttributeNS(null, 'href', 'images/splash-ring.png');
    ring.setAttribute('x', String(target.x - size / 2));
    ring.setAttribute('y', String(target.y - size / 2));
    ring.setAttribute('width', String(size));
    ring.setAttribute('height', String(size));
    ring.setAttribute('class', 'splash-ring');

    const play = () => {
      splashFx.appendChild(ring);
      playSplashSound();
      if (reduced) {
        setTimeout(() => ring.remove(), 1);
        return;
      }
      requestAnimationFrame(() => ring.classList.add('is-playing'));
      setTimeout(() => ring.remove(), SPLASH_MS + 30);
    };
    if (delayMs > 0) setTimeout(play, delayMs); else play();
  }

  const wait = (ms) => new Promise(r => setTimeout(r, reduced ? 0 : ms));

  async function shakeMelon() {
    melon.classList.remove('is-shaking');
    void melon.offsetWidth;       // force reflow so the keyframe re-runs
    melon.classList.add('is-shaking');
    await wait(MELON_SHAKE_MS);
    melon.classList.remove('is-shaking');
  }

  async function dropMelon() {
    const fx = (Math.random() * 60 - 10).toFixed(1);
    const fr = (Math.random() * 50 + 18).toFixed(1);
    melon.style.setProperty('--fall-x', fx + 'px');
    melon.style.setProperty('--fall-r', fr + 'deg');
    melon.classList.add('is-falling');
    await wait(1150);
    melon.classList.remove('is-falling');
    melon.style.removeProperty('--fall-x');
    melon.style.removeProperty('--fall-r');
    melon.setAttribute('data-stage', '0');
    melon.style.setProperty('--scale', stageScales[0]);
    currentStage = 0;
    reportGrow();
    await wait(600);
  }

  async function water() {
    if (busy) return;
    busy = true;

    if (currentStage === 0) rollStageScales();

    splashFx.innerHTML = '';
    const targets = Array.from({ length: DROP_COUNT }, () => randomTarget());
    const impacts = spawnDrops(SPOUT, targets);
    for (let i = 0; i < impacts.length; i++) {
      const t = impacts[i].target;
      const splashSize = Math.round(impacts[i].dropSize * 4.6);
      spawnSplash(
        { x: t.x + SPLASH_OFFSET_X, y: t.y },
        splashSize,
        DROP_TRAVEL_MS + (i * DROP_STAGGER_MS)
      );
    }
    await wait(GROWTH_AFTER_SPLASH_MS);

    if (currentStage < MAX_STAGE) {
      await shakeMelon();
      setStage(currentStage + 1);
      await wait(750);
    }
    if (currentStage === MAX_STAGE) {
      await wait(700);
      await dropMelon();
    }

    busy = false;
  }

  stage.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="water"]')) water();
  });

  rollStageScales();
  setStage(0);
  loadGlobalState();
})();
