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
      if (txt != null) el.textContent = txt;
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
