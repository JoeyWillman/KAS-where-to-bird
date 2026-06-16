/**
 * Kitsap Audubon – Where to Bird Map
 * main.js
 */

// ─────────────────────────────────────────────
//  DATA SOURCE
// ─────────────────────────────────────────────
// The site data is read from a published Google Sheet (CSV format).
// To update sites, edit the Google Sheet — changes appear on the map
// within a few minutes (Google caches the published feed briefly).
//
// HOW TO POINT THIS AT YOUR SHEET:
//   1. In Google Sheets: File → Share → Publish to web
//   2. Choose the sheet tab + "Comma-separated values (.csv)"
//   3. Publish, copy the URL, and paste it below as GOOGLE_SHEET_CSV
//
// FALLBACK: to use the local sites.csv file instead (e.g. for testing
// offline or if the Sheet is unavailable), set USE_GOOGLE_SHEET = false.

const USE_GOOGLE_SHEET = true;
const GOOGLE_SHEET_CSV  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQKpT1LAcBqkKwIjtQ8AdhuCadAGOXzZ1s_ANfeLPVBK2tU3-Ed8qvUyAStIg836tomqktj12tT7yas/pub?gid=1629256792&single=true&output=csv';
const LOCAL_CSV         = 'sites.csv';

const CSV_PATH      = USE_GOOGLE_SHEET ? GOOGLE_SHEET_CSV : LOCAL_CSV;
const MAP_CENTER    = [47.70, -122.68];
const MAP_ZOOM      = 10;
const EBIRD_API_KEY = 'tjd5dj8076eb';
const EBIRD_BASE    = 'https://api.ebird.org/v2';

// Searchable index of sites: { sitename, site, marker, lat, lng }
let searchIndex = [];

// ─────────────────────────────────────────────
//  MAP INIT
// ─────────────────────────────────────────────
const map = L.map('map', {
  center: MAP_CENTER,
  zoom: MAP_ZOOM,
  zoomControl: true,
  minZoom: 7,
  maxBounds: [[44.0, -126.5], [50.5, -114.5]],
  maxBoundsViscosity: 1.0,
});

// CartoDB Voyager — free, no key, no account
const baseTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 19,
  subdomains: 'abcd',      // spread requests across 4 servers (faster, fewer rate limits)
  keepBuffer: 6,           // keep more off-screen tiles cached so panning back is instant
  updateWhenIdle: false,   // load tiles continuously while panning, not only after stopping
  updateWhenZooming: false,// don't thrash tile requests mid-zoom
  crossOrigin: true,
});

// Retry tiles that fail to load (instead of leaving them grey)
baseTiles.on('tileerror', (e) => {
  const tile = e.tile;
  const retries = parseInt(tile.dataset.retries || '0', 10);
  if (retries < 2) {
    tile.dataset.retries = String(retries + 1);
    const src = tile.src;
    // Force a reload by re-assigning the src after a short delay
    setTimeout(() => { tile.src = src.includes('?') ? src : src + '?r=' + Date.now(); }, 600);
  }
});

baseTiles.addTo(map);

// Fix Leaflet default icon 401 errors on GitHub Pages
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom kingfisher marker — completed sites
const birdIcon = L.divIcon({
  className: 'bird-marker',
  html: `<div class="marker-pin">
           <img src="data/img/kingfisher.png" alt="" />
         </div>`,
  iconSize: [40, 40],
  iconAnchor: [20, 40],
  popupAnchor: [0, -42],
});

// Incomplete site marker — simple grey dot
const incompleteIcon = L.divIcon({
  className: '',
  html: `<div class="marker-incomplete"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  popupAnchor: [0, -10],
});

// Out-of-county complete site marker — small green dot
const outOfCountyIcon = L.divIcon({
  className: '',
  html: `<div class="marker-out-of-county"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  popupAnchor: [0, -10],
});

// Rarity marker icon — red circle
const rarityIcon = L.divIcon({
  className: '',
  html: `<div class="layer-marker layer-marker--rarity"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -10],
});

// High count marker icon — blue circle
const highCountIcon = L.divIcon({
  className: '',
  html: `<div class="layer-marker layer-marker--highcount"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -10],
});

// Subdued marker — for complete Kitsap sites NOT in the top 10 most-visited
const subduedIcon = L.divIcon({
  className: 'bird-marker',
  html: `<div class="marker-pin marker-pin--subdued">
           <img src="data/img/kingfisher.png" alt="" />
         </div>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -30],
});

// Kitsap County eBird region code
const KITSAP_REGION = 'US-WA-035';

// Layer group for rarities
const rarityLayer  = L.layerGroup();
let rarityLayerOn  = false;
let layerDays      = 7;
let rarityCache    = { data: null, days: null };

// Layer group for out-of-county sites
const otherSitesLayer = L.layerGroup();
let otherSitesLayerOn = true;

// Layer group for Kitsap County sites
const kitsapSitesLayer = L.layerGroup();
let kitsapSitesLayerOn = true;

// ─────────────────────────────────────────────
//  RARITIES DRAWER
// ─────────────────────────────────────────────
const raritiesDrawer = document.getElementById('rarities-drawer');

function openRaritiesDrawer() {
  // Opening rarities closes the site detail panel (mutually exclusive)
  closePanel();
  raritiesDrawer.classList.add('open');
  raritiesDrawer.setAttribute('aria-hidden', 'false');
  raritiesDrawer.inert = false;
  // Shrink the map so it stays visible above the bottom sheet (mobile)
  document.querySelector('.map-layout').classList.add('rarities-active');
  setTimeout(() => map.invalidateSize(), 320);
}

function closeRaritiesDrawer() {
  // Move focus out before hiding, or aria-hidden traps it (a11y + bug)
  if (raritiesDrawer.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  raritiesDrawer.classList.remove('open');
  raritiesDrawer.setAttribute('aria-hidden', 'true');
  raritiesDrawer.inert = true;
  document.querySelector('.map-layout').classList.remove('rarities-active');
  setTimeout(() => map.invalidateSize(), 320);
}

// Fully turn off the rarities layer + drawer (used by the drawer's × button)
function dismissRarities() {
  rarityLayerOn = false;
  const btn = document.getElementById('toggle-rarities');
  if (btn) btn.classList.remove('active');
  map.removeLayer(rarityLayer);
  closeRaritiesDrawer();
}

function renderRaritiesDrawer(rarities, days) {
  const list    = document.getElementById('rarities-drawer-list');
  const empty   = document.getElementById('rarities-drawer-empty');
  const loading = document.getElementById('rarities-drawer-loading');
  const meta    = document.getElementById('rarities-drawer-meta');

  loading.style.display = 'none';
  meta.textContent = `${rarities.length} sighting${rarities.length !== 1 ? 's' : ''} · last ${days} day${days !== 1 ? 's' : ''}`;

  list.innerHTML = '';

  if (!rarities.length) {
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  rarities.forEach(obs => {
    const li = document.createElement('li');
    li.className = 'rarity-row';

    const count = obs.howMany
      ? `<span class="rarity-row-count">${Number(obs.howMany).toLocaleString()}</span>` : '';
    const date = obs.obsDt
      ? `<span class="rarity-row-date">${formatDate(obs.obsDt)}</span>` : '';
    const loc = obs.locName
      ? `<span class="rarity-row-loc">📍 ${obs.locName}</span>` : '';

    li.innerHTML = `
      <div class="rarity-row-name">${obs.comName}</div>
      <div class="rarity-row-sci">${obs.sciName}</div>
      <div class="rarity-row-meta">${loc}${count}${date}</div>`;

    // Clicking a row pans map to that marker and opens its popup
    if (obs.lat && obs.lng) {
      li.addEventListener('click', () => {
        const targetZoom = Math.max(map.getZoom(), 13);
        map.setView([obs.lat, obs.lng], targetZoom, { animate: true });

        // On mobile the bottom sheet covers ~42% of the screen, so nudge the
        // map up after centering, keeping the pin in the visible upper area.
        if (window.matchMedia('(max-width: 767px)').matches) {
          map.once('moveend', () => {
            const sheet = document.querySelector('.rarities-drawer');
            const offsetY = sheet ? sheet.offsetHeight / 2 : 0;
            if (offsetY) map.panBy([0, offsetY], { animate: true });
          });
        }

        // Open the matching rarity marker popup
        rarityLayer.eachLayer(marker => {
          const ll = marker.getLatLng();
          if (Math.abs(ll.lat - obs.lat) < 0.0001 && Math.abs(ll.lng - obs.lng) < 0.0001) {
            marker.openPopup();
          }
        });
      });
    }

    list.appendChild(li);
  });
}


// ─────────────────────────────────────────────
//  MAP LAYER TOGGLE CONTROLS (injected into map)
// ─────────────────────────────────────────────
const layerControlDiv = L.DomUtil.create('div', 'map-layer-controls');
layerControlDiv.innerHTML = `
  <button id="layers-toggle-btn" class="layers-toggle-btn" title="Map layers" aria-label="Toggle map layers" aria-expanded="true">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
  <div class="layer-toggle-group" id="layer-toggle-group">
    <button id="toggle-kitsap-sites" class="layer-toggle active" title="Toggle Kitsap County sites">
      <span class="layer-dot layer-dot--kitsap"></span> Kitsap Sites
    </button>
    <button id="toggle-other-sites" class="layer-toggle active" title="Toggle sites outside Kitsap County">
      <span class="layer-dot layer-dot--other"></span> Other Counties
    </button>
    <button id="toggle-rarities" class="layer-toggle" title="Show county-wide rarities">
      <span class="layer-dot layer-dot--rarity"></span> Rarities
    </button>
    <div id="layer-status" class="layer-status" style="display:none">
      <span class="layer-spinner"></span> Loading…
    </div>
  </div>`;

// Prevent map clicks from propagating through the control
L.DomEvent.disableClickPropagation(layerControlDiv);

// Add as a custom Leaflet control (top-left, below zoom)
const LayerControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: () => layerControlDiv,
});
new LayerControl().addTo(map);
kitsapSitesLayer.addTo(map);
otherSitesLayer.addTo(map);

// Collapsible layers panel
const layersToggleBtn = document.getElementById('layers-toggle-btn');
const layerToggleGroup = document.getElementById('layer-toggle-group');

function setLayersCollapsed(collapsed) {
  layerControlDiv.classList.toggle('collapsed', collapsed);
  layersToggleBtn.setAttribute('aria-expanded', String(!collapsed));
}

layersToggleBtn.addEventListener('click', () => {
  const isCollapsed = layerControlDiv.classList.contains('collapsed');
  setLayersCollapsed(!isCollapsed);
});

// Start collapsed on mobile (saves map space), expanded on desktop
setLayersCollapsed(window.matchMedia('(max-width: 767px)').matches);

// ─────────────────────────────────────────────
//  FULLSCREEN BUTTON
// ─────────────────────────────────────────────
const fsControlDiv = L.DomUtil.create('div', 'leaflet-bar');
fsControlDiv.style.border = 'none';
fsControlDiv.innerHTML = `
  <button id="map-fullscreen" class="map-fullscreen-btn" title="Toggle fullscreen" aria-label="Toggle fullscreen">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>`;
L.DomEvent.disableClickPropagation(fsControlDiv);

const FullscreenControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd: () => fsControlDiv,
});
new FullscreenControl().addTo(map);

// ─────────────────────────────────────────────
//  INFO BUTTON (Leaflet control, stacks under fullscreen, top-right)
// ─────────────────────────────────────────────
const infoControlDiv = L.DomUtil.create('div', 'leaflet-bar');
infoControlDiv.style.border = 'none';
infoControlDiv.innerHTML = `
  <button id="info-btn" class="info-btn" title="About this map" aria-label="About this map">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
      <path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
  </button>`;
L.DomEvent.disableClickPropagation(infoControlDiv);

const InfoControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd: () => infoControlDiv,
});
new InfoControl().addTo(map);

// The element we want to fullscreen — the whole map+panel layout
const fullscreenTarget = document.querySelector('.map-layout');

function isFullscreen() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

function toggleFullscreen() {
  if (!isFullscreen()) {
    const el = fullscreenTarget;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) req.call(el);
  } else {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) exit.call(document);
  }
}

document.getElementById('map-fullscreen').addEventListener('click', toggleFullscreen);

// Keep Leaflet sized correctly when entering/leaving fullscreen
['fullscreenchange', 'webkitfullscreenchange'].forEach(evt =>
  document.addEventListener(evt, () => setTimeout(() => map.invalidateSize(), 200))
);


// ─────────────────────────────────────────────
//  FETCH COUNTY-WIDE LAYER DATA
// ─────────────────────────────────────────────
async function fetchRarities(days) {
  const status  = document.getElementById('layer-status');
  const loading = document.getElementById('rarities-drawer-loading');
  status.style.display  = '';
  loading.style.display = '';

  try {
    const res = await fetch(
      `${EBIRD_BASE}/data/obs/${KITSAP_REGION}/recent/notable?maxResults=100&back=${days}&detail=full`,
      { headers: { 'X-eBirdApiToken': EBIRD_API_KEY } }
    );
    const data = res.ok ? await res.json() : [];
    const seenR = new Set();
    const rarities = data.filter(o => {
      if (!o.lat || !o.lng) return false;
      const key = `${o.speciesCode}-${o.locId}`;
      if (seenR.has(key)) return false;
      seenR.add(key); return true;
    });
    rarityCache = { data: rarities, days };
    renderRaritiesDrawer(rarities, days);
    return rarities;
  } catch (err) {
    console.error('Rarity fetch failed:', err);
    renderRaritiesDrawer([], days);
    return [];
  } finally {
    status.style.display  = 'none';
    loading.style.display = 'none';
  }
}

function buildLayerPopup(obs, type) {
  const count = obs.howMany ? `<span class="popup-count">${Number(obs.howMany).toLocaleString()}</span>` : '';
  const date  = obs.obsDt ? `<span class="popup-date">${formatDate(obs.obsDt)}</span>` : '';
  const badge = type === 'rarity'
    ? `<span class="obs-badge badge-rare">Rare</span>`
    : `<span class="obs-badge badge-highcount">High Count</span>`;
  return `
    <div class="layer-popup">
      <div class="popup-name">${obs.comName}</div>
      <div class="popup-sci">${obs.sciName}</div>
      <div class="popup-meta">${badge} ${count} ${date}</div>
      <div class="popup-loc">📍 ${obs.locName || ''}</div>
    </div>`;
}

function renderRarityLayer(rarities) {
  rarityLayer.clearLayers();
  rarities.forEach(obs => {
    L.marker([obs.lat, obs.lng], { icon: rarityIcon })
      .bindPopup(buildLayerPopup(obs, 'rarity'), { maxWidth: 240 })
      .addTo(rarityLayer);
  });
}

async function refreshLayers(days) {
  layerDays = days;
  if (!rarityLayerOn) return;
  const rarities = await fetchRarities(days);
  renderRarityLayer(rarities);
}
document.getElementById('toggle-kitsap-sites').addEventListener('click', () => {
  kitsapSitesLayerOn = !kitsapSitesLayerOn;
  document.getElementById('toggle-kitsap-sites').classList.toggle('active', kitsapSitesLayerOn);
  if (kitsapSitesLayerOn) {
    kitsapSitesLayer.addTo(map);
  } else {
    map.removeLayer(kitsapSitesLayer);
  }
});

document.getElementById('toggle-other-sites').addEventListener('click', () => {
  otherSitesLayerOn = !otherSitesLayerOn;
  document.getElementById('toggle-other-sites').classList.toggle('active', otherSitesLayerOn);
  if (otherSitesLayerOn) {
    otherSitesLayer.addTo(map);
  } else {
    map.removeLayer(otherSitesLayer);
  }
});

document.getElementById('toggle-rarities').addEventListener('click', async () => {
  rarityLayerOn = !rarityLayerOn;
  document.getElementById('toggle-rarities').classList.toggle('active', rarityLayerOn);

  if (rarityLayerOn) {
    rarityLayer.addTo(map);
    openRaritiesDrawer();
    const cached = rarityCache.days === layerDays && rarityCache.data;
    if (cached) {
      renderRaritiesDrawer(rarityCache.data, layerDays);
      renderRarityLayer(rarityCache.data);
    } else {
      const rarities = await fetchRarities(layerDays);
      renderRarityLayer(rarities);
    }
  } else {
    map.removeLayer(rarityLayer);
    closeRaritiesDrawer();
  }
});


// ─────────────────────────────────────────────
//  DOM REFS
// ─────────────────────────────────────────────
const panel          = document.getElementById('detail-panel');
const panelClose     = document.getElementById('panel-close');
const panelTitle     = document.getElementById('panel-title');
const panelArea      = document.getElementById('panel-area');
const panelDesc      = document.getElementById('panel-description');
const slideshowWrap  = document.getElementById('slideshow-wrap');
const slideshow      = document.getElementById('slideshow');
const slideDots      = document.getElementById('slide-dots');
const prevBtn        = document.getElementById('slide-prev');
const nextBtn        = document.getElementById('slide-next');
const eBirdLoading   = document.getElementById('ebird-loading');
const eBirdContent   = document.getElementById('ebird-content');
const eBirdNone      = document.getElementById('ebird-none');
const eBirdLink      = document.getElementById('ebird-link');
const listRarities   = document.getElementById('list-rarities');
const listHighcount  = document.getElementById('list-highcount');
const listRecent     = document.getElementById('list-recent');

let currentSlide   = 0;
let slideImages    = [];
let activeMarker   = null;
let currentHotspot = null;
let activeDays     = 7;
let activeTab      = 'recent';

// ─────────────────────────────────────────────
//  SLIDESHOW
// ─────────────────────────────────────────────
function buildSlideshow(photos) {
  slideshow.innerHTML = '';
  slideDots.innerHTML = '';
  slideImages  = photos;
  currentSlide = 0;

  photos.forEach((src, i) => {
    const img     = document.createElement('img');
    img.src       = src;
    img.alt       = `Site photo ${i + 1}`;
    img.className = 'slide-img' + (i === 0 ? ' active' : '');
    img.loading   = 'lazy';
    slideshow.appendChild(img);

    const dot     = document.createElement('button');
    dot.className = 'dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', `Photo ${i + 1}`);
    dot.addEventListener('click', () => goToSlide(i));
    slideDots.appendChild(dot);
  });

  const multi = photos.length > 1;
  prevBtn.style.display   = multi ? '' : 'none';
  nextBtn.style.display   = multi ? '' : 'none';
  slideDots.style.display = multi ? '' : 'none';
}

function goToSlide(index) {
  const imgs = slideshow.querySelectorAll('.slide-img');
  const dots = slideDots.querySelectorAll('.dot');
  imgs[currentSlide]?.classList.remove('active');
  dots[currentSlide]?.classList.remove('active');
  currentSlide = (index + slideImages.length) % slideImages.length;
  imgs[currentSlide]?.classList.add('active');
  dots[currentSlide]?.classList.add('active');
}

prevBtn.addEventListener('click', () => goToSlide(currentSlide - 1));
nextBtn.addEventListener('click', () => goToSlide(currentSlide + 1));
panel.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft')  goToSlide(currentSlide - 1);
  if (e.key === 'ArrowRight') goToSlide(currentSlide + 1);
  if (e.key === 'Escape')     closePanel();
});

// ─────────────────────────────────────────────
//  LIGHTBOX
// ─────────────────────────────────────────────
const lightbox      = document.getElementById('lightbox');
const lightboxImg   = document.getElementById('lightbox-img');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxPrev  = document.getElementById('lightbox-prev');
const lightboxNext  = document.getElementById('lightbox-next');
const lightboxCap   = document.getElementById('lightbox-caption');

function openLightbox(index) {
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
  setLightboxSlide(index);
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightbox.classList.remove('open');
  lightbox.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function setLightboxSlide(index) {
  currentSlide = (index + slideImages.length) % slideImages.length;
  lightboxImg.src = slideImages[currentSlide];
  lightboxCap.textContent = slideImages.length > 1
    ? `${currentSlide + 1} / ${slideImages.length}` : '';
  // Sync the panel slideshow dots too
  const imgs = slideshow.querySelectorAll('.slide-img');
  const dots = slideDots.querySelectorAll('.dot');
  imgs.forEach((img, i) => img.classList.toggle('active', i === currentSlide));
  dots.forEach((dot, i) => dot.classList.toggle('active', i === currentSlide));
  lightboxPrev.style.display = slideImages.length > 1 ? '' : 'none';
  lightboxNext.style.display = slideImages.length > 1 ? '' : 'none';
}

document.getElementById('expand-btn').addEventListener('click', () => openLightbox(currentSlide));
lightboxClose.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click', () => setLightboxSlide(currentSlide - 1));
lightboxNext.addEventListener('click', () => setLightboxSlide(currentSlide + 1));
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (!lightbox.classList.contains('open')) return;
  if (e.key === 'Escape')     closeLightbox();
  if (e.key === 'ArrowLeft')  setLightboxSlide(currentSlide - 1);
  if (e.key === 'ArrowRight') setLightboxSlide(currentSlide + 1);
});


// ─────────────────────────────────────────────
//  EBIRD TABS
// ─────────────────────────────────────────────
function switchTab(tabName) {
  activeTab = tabName;
  document.querySelectorAll('.ebird-tab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tabName));
  document.querySelectorAll('.ebird-pane').forEach(pane =>
    pane.style.display = pane.id === `pane-${tabName}` ? '' : 'none');
}

document.querySelectorAll('.ebird-tab').forEach(btn =>
  btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

// ─────────────────────────────────────────────
//  EBIRD RANGE PILLS
// ─────────────────────────────────────────────
document.querySelectorAll('.range-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    activeDays = parseInt(pill.dataset.days);
    layerDays  = activeDays;
    document.querySelectorAll('.range-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    if (currentHotspot) loadEbird(currentHotspot, activeDays);
    refreshLayers(activeDays);
  });
});

// ─────────────────────────────────────────────
//  EBIRD API
// ─────────────────────────────────────────────
function eBirdHeaders() {
  return { 'X-eBirdApiToken': EBIRD_API_KEY };
}

async function fetchEbird(hotspotId, days) {
  const [recentRes, notableRes] = await Promise.all([
    fetch(`${EBIRD_BASE}/data/obs/${hotspotId}/recent?maxResults=200&back=${days}`,
      { headers: eBirdHeaders() }),
    fetch(`${EBIRD_BASE}/data/obs/${hotspotId}/recent/notable?maxResults=50&back=${days}`,
      { headers: eBirdHeaders() }),
  ]);
  const recent  = recentRes.ok  ? await recentRes.json()  : [];
  const notable = notableRes.ok ? await notableRes.json() : [];
  return { recent, notable };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildEbirdLi(obs, badge) {
  const li = document.createElement('li');
  li.className = 'ebird-item';
  const count = obs.howMany ? `<span class="obs-count">${Number(obs.howMany).toLocaleString()}</span>` : '';
  const date  = `<span class="obs-date">${formatDate(obs.obsDt)}</span>`;
  const name  = `<span class="obs-name">${obs.comName}</span>`;
  const sci   = `<span class="obs-sci">${obs.sciName}</span>`;
  const bdg   = badge ? `<span class="obs-badge ${badge.cls}">${badge.label}</span>` : '';
  li.innerHTML = `${bdg}${name} ${sci} ${count} ${date}`;
  return li;
}

function renderEbird(recent, notable) {
  // Rarities
  listRarities.innerHTML = '';
  const emptyRarities = document.getElementById('empty-rarities');
  notable.forEach(obs => listRarities.appendChild(buildEbirdLi(obs, { label: 'Rare', cls: 'badge-rare' })));
  emptyRarities.style.display = notable.length ? 'none' : '';

  // High counts
  listHighcount.innerHTML = '';
  const emptyHighcount = document.getElementById('empty-highcount');
  const withCounts = recent.filter(o => o.howMany && o.howMany > 1);
  withCounts.sort((a, b) => b.howMany - a.howMany);
  const seenCount = new Set();
  const topCounts = withCounts.filter(o => {
    if (seenCount.has(o.speciesCode)) return false;
    seenCount.add(o.speciesCode); return true;
  }).slice(0, 20);
  topCounts.forEach(obs => listHighcount.appendChild(buildEbirdLi(obs, null)));
  emptyHighcount.style.display = topCounts.length ? 'none' : '';

  // Recent (all species, deduped)
  listRecent.innerHTML = '';
  const emptyRecent = document.getElementById('empty-recent');
  const seenRecent = new Set();
  const recentDedup = recent.filter(o => {
    if (seenRecent.has(o.speciesCode)) return false;
    seenRecent.add(o.speciesCode); return true;
  });
  recentDedup.forEach(obs => listRecent.appendChild(buildEbirdLi(obs, null)));
  emptyRecent.style.display = recentDedup.length ? 'none' : '';

  const hasAny = notable.length || topCounts.length || recentDedup.length;
  eBirdContent.style.display = hasAny ? '' : 'none';
  eBirdNone.style.display    = hasAny ? 'none' : '';

  // Re-apply active tab so correct pane shows after re-render
  switchTab(activeTab);
}

const ESCALATION_LADDER = [1, 3, 7, 14, 30];

// Called on initial site open — escalates up through ranges until data found
async function loadEbirdAuto(hotspotId, startDays) {
  const loadingText = document.getElementById('ebird-loading-text');
  eBirdLoading.style.display = '';
  eBirdContent.style.display = 'none';
  eBirdNone.style.display    = 'none';

  const ladder = ESCALATION_LADDER.filter(d => d >= startDays);

  for (const days of ladder) {
    loadingText.textContent = `Searching last ${days} day${days !== 1 ? 's' : ''}…`;
    try {
      const { recent, notable } = await fetchEbird(hotspotId, days);
      if (recent.length > 0 || notable.length > 0) {
        // Snap pill to the range that found data
        document.querySelectorAll('.range-pill').forEach(p =>
          p.classList.toggle('active', parseInt(p.dataset.days) === days));
        activeDays = days;
        layerDays  = days;
        renderEbird(recent, notable);
        eBirdLink.href          = `https://ebird.org/hotspot/${hotspotId}`;
        eBirdLink.style.display = '';
        eBirdLoading.style.display = 'none';
        return;
      }
    } catch (err) {
      console.error('eBird fetch failed:', err);
    }
  }

  // Nothing found across all ranges
  setEbirdNoneMessage(30);
  eBirdNone.style.display    = '';
  eBirdLoading.style.display = 'none';
}

// Called on manual pill click — fixed range, no escalation
async function loadEbird(hotspotId, days) {
  const loadingText = document.getElementById('ebird-loading-text');
  eBirdLoading.style.display = '';
  eBirdContent.style.display = 'none';
  eBirdNone.style.display    = 'none';
  loadingText.textContent    = `Searching last ${days} day${days !== 1 ? 's' : ''}…`;

  try {
    const { recent, notable } = await fetchEbird(hotspotId, days);
    if (recent.length > 0 || notable.length > 0) {
      renderEbird(recent, notable);
      eBirdLink.href          = `https://ebird.org/hotspot/${hotspotId}`;
      eBirdLink.style.display = '';
    } else {
      setEbirdNoneMessage(days);
      eBirdNone.style.display = '';
    }
  } catch (err) {
    console.error('eBird fetch failed:', err);
    setEbirdNoneMessage(days);
    eBirdNone.style.display = '';
  } finally {
    eBirdLoading.style.display = 'none';
  }
}

function setEbirdNoneMessage(days) {
  document.getElementById('ebird-none-days').textContent   = days;
  document.getElementById('ebird-none-plural').textContent = days === 1 ? '' : 's';
}


// ─────────────────────────────────────────────
//  PANEL OPEN / CLOSE
// ─────────────────────────────────────────────
function openPanel(site) {
  // Opening a site always closes the rarities drawer (mutually exclusive)
  rarityLayerOn = false;
  document.getElementById('toggle-rarities').classList.remove('active');
  if (map.hasLayer(rarityLayer)) map.removeLayer(rarityLayer);
  closeRaritiesDrawer();

  panelTitle.textContent = site.sitename || '';
  panelArea.textContent  = site.area     || '';

  // Description
  const desc = site.desc || '';
  panelDesc.textContent = desc;
  document.getElementById('section-desc').style.display = desc ? '' : 'none';

  // Directions
  const lat = parseFloat(site.lat);
  const lng = parseFloat(site.lng);
  const directionsBtn = document.getElementById('directions-btn');
  if (!isNaN(lat) && !isNaN(lng)) {
    directionsBtn.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    directionsBtn.style.display = '';
  } else {
    directionsBtn.style.display = 'none';
  }

  // Photos
  const photos = (site.photos || '').split('|').map(s => s.trim()).filter(Boolean);
  if (photos.length) { buildSlideshow(photos); slideshowWrap.style.display = ''; }
  else { slideshowWrap.style.display = 'none'; }

  // Accessibility
  const accessText = (site.accessibility || '').trim();
  const accessContent = document.getElementById('access-content');
  const sectionAccess = document.getElementById('section-access');
  if (accessText) {
    const entries = accessText.split('|').map(s => s.trim()).filter(Boolean);
    const icons = { 'Parking': '🅿️', 'Wheelchair': '♿', 'Restrooms': '🚻', 'Terrain': '🥾', 'Dogs': '🐕' };
    const getIcon = (label) => Object.keys(icons).find(k => label.startsWith(k)) ? icons[Object.keys(icons).find(k => label.startsWith(k))] : '•';
    accessContent.innerHTML = `<ul class="access-list">${entries.map(e => {
      const [label, ...rest] = e.split(':');
      const value = rest.join(':').trim();
      return `<li><span class="access-icon">${getIcon(label.trim())}</span><span class="access-label">${label.trim()}:</span> ${value}</li>`;
    }).join('')}</ul>`;
    sectionAccess.style.display = '';
  } else {
    sectionAccess.style.display = 'none';
  }

  // YouTube
  const youtubeId = (site.youtube_id || '').trim();
  const sectionVideo = document.getElementById('section-video');
  const youtubeWrap  = document.getElementById('youtube-wrap');
  if (youtubeId && !youtubeId.startsWith('PLACEHOLDER')) {
    youtubeWrap.innerHTML = `<iframe src="https://www.youtube.com/embed/${youtubeId}" title="How to bird at ${site.sitename}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
    sectionVideo.style.display = '';
  } else {
    sectionVideo.style.display = 'none';
  }

  // eBird
  const hotspotId = (site.ebird_hotspot_id || '').trim();
  const sectionEbird = document.getElementById('section-ebird');
  if (hotspotId && !hotspotId.startsWith('PLACEHOLDER')) {
    currentHotspot = hotspotId;
    sectionEbird.style.display = '';
    loadEbirdAuto(hotspotId, activeDays);
  } else {
    currentHotspot = null;
    sectionEbird.style.display = 'none';
  }

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  panel.inert = false;
  panel.scrollTop = 0;
  panel.focus();
}

function closePanel() {
  if (panel.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  panel.inert = true;
  currentHotspot = null;
  activeMarker   = null;
}

panelClose.addEventListener('click', closePanel);
map.on('click', closePanel);

// Rarities drawer close button — fully dismisses the rarities layer + drawer
document.getElementById('rarities-drawer-close').addEventListener('click', dismissRarities);

// ─────────────────────────────────────────────
//  RECENT ACTIVITY (sites with a checklist in the last 3 days)
// ─────────────────────────────────────────────
// A site is "active" if it has at least one eBird checklist in the window.
// One API call per hotspot is heavy, so results are cached for 24 hours.

const ACTIVITY_DAYS      = 3;
const ACTIVITY_CACHE_KEY = 'kasRecentActivity_v2';
const ACTIVITY_TTL_MS    = 3 * 60 * 60 * 1000; // 3 hours — balances freshness vs. API load

// eBird date fields vary by endpoint. The checklist-feed (/product/lists)
// provides `isoObsDate` (reliable ISO) plus `obsDt` (often day-only or
// "DD Mon YYYY" text). Prefer isoObsDate; fall back to normalizing obsDt.
function parseEbirdDate(str) {
  if (!str) return null;
  let s = String(str).trim();
  // Space-separated "2026-06-11 08:30" → ISO "2026-06-11T08:30"
  if (/^\d{4}-\d{2}-\d{2}\s/.test(s)) s = s.replace(' ', 'T');
  let d = new Date(s);
  return isNaN(d) ? null : d;
}

// Does this hotspot have any checklist in the last ACTIVITY_DAYS days?
async function hasRecentChecklist(hotspotId) {
  try {
    const res = await fetch(
      `${EBIRD_BASE}/product/lists/${hotspotId}?maxResults=200`,
      { headers: { 'X-eBirdApiToken': EBIRD_API_KEY } }
    );
    if (!res.ok) return false;
    const lists = await res.json();
    // Compare on date only (strip time) to avoid timezone edge effects.
    const today = new Date();
    const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    cutoff.setDate(cutoff.getDate() - (ACTIVITY_DAYS - 1)); // inclusive window

    return lists.some(l => {
      const d = parseEbirdDate(l.isoObsDate || l.obsDt);
      if (!d) return false;
      // Normalize to midnight for a clean date comparison
      const dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      return dd.getTime() >= cutoff.getTime();
    });
  } catch (err) {
    console.error('Activity check failed for', hotspotId, err);
    return false;
  }
}

// Returns a Set of hotspot IDs that have recent activity.
// Cached for 24h so we don't hammer the API on every load.
async function getActiveHotspots(hotspotIds) {
  try {
    const cached = JSON.parse(localStorage.getItem(ACTIVITY_CACHE_KEY) || 'null');
    if (cached && (Date.now() - cached.ts) < ACTIVITY_TTL_MS && Array.isArray(cached.active)) {
      return new Set(cached.active);
    }
  } catch (_) { /* ignore bad cache */ }

  const active = [];
  const BATCH = 6;
  for (let i = 0; i < hotspotIds.length; i += BATCH) {
    const batch = hotspotIds.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async id => ({
      id, active: await hasRecentChecklist(id),
    })));
    results.forEach(r => { if (r.active) active.push(r.id); });
  }

  // Diagnostic — remove once confirmed working
  console.log(`[KAS] Checked ${hotspotIds.length} hotspots, ${active.length} active in last ${ACTIVITY_DAYS} days:`, active);

  try {
    localStorage.setItem(ACTIVITY_CACHE_KEY, JSON.stringify({ ts: Date.now(), active }));
  } catch (_) { /* storage may be unavailable */ }

  return new Set(active);
}


Papa.parse(CSV_PATH, {
  download: true,
  header: true,
  skipEmptyLines: true,
  complete: async ({ data: sites }) => {
    const loadingEl = document.getElementById('map-loading');
    if (!sites.length) {
      if (loadingEl) loadingEl.style.display = 'none';
      return;
    }

    // Collect hotspot IDs from complete Kitsap sites for popularity ranking
    const rankableIds = sites
      .filter(s => (s.complete || '').trim() === 'x'
                && (s.county || '').trim() === 'Kitsap'
                && (s.ebird_hotspot_id || '').trim()
                && !(s.ebird_hotspot_id || '').trim().startsWith('PLACEHOLDER'))
      .map(s => s.ebird_hotspot_id.trim());

    // Kick off activity check (cached daily). Render markers immediately with
    // a fallback so the map isn't blocked if the API is slow; re-style once
    // the active set resolves.
    let activeSet = new Set();
    const renderMarkers = () => {
      kitsapSitesLayer.clearLayers();
      otherSitesLayer.clearLayers();
      searchIndex = [];

      sites.forEach(site => {
        const lat = parseFloat(site.lat);
        const lng = parseFloat(site.lng);
        if (isNaN(lat) || isNaN(lng)) return;

        const isComplete = (site.complete || '').trim() === 'x';
        const isKitsap   = (site.county  || '').trim() === 'Kitsap';
        const target     = isKitsap ? kitsapSitesLayer : otherSitesLayer;
        const hotspotId  = (site.ebird_hotspot_id || '').trim();

        if (isComplete) {
          // Sites with a checklist in the last 3 days get the full marker;
          // other complete Kitsap sites get the subdued marker.
          let markerIcon, tooltipOffset;
          if (isKitsap) {
            const isActive = activeSet.has(hotspotId);
            markerIcon    = isActive ? birdIcon : subduedIcon;
            tooltipOffset = isActive ? [0, -28] : [0, -20];
          } else {
            markerIcon    = outOfCountyIcon;
            tooltipOffset = [0, -8];
          }

          const marker = L.marker([lat, lng], { icon: markerIcon })
            .addTo(target)
            .bindTooltip(site.sitename || '', {
              permanent: false, direction: 'top',
              className: 'site-tooltip', offset: tooltipOffset,
            });
          marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            activeMarker = marker;
            openPanel(site);
          });

          searchIndex.push({
            sitename: site.sitename || '', site, marker, lat, lng, complete: true,
          });
        } else {
          const marker = L.marker([lat, lng], { icon: incompleteIcon })
            .addTo(target)
            .bindTooltip(`${site.sitename || 'Unnamed site'} <span class="tooltip-coming-soon">coming soon</span>`, {
              permanent: false, direction: 'top',
              className: 'site-tooltip site-tooltip--incomplete',
              offset: [0, -8],
            });

          searchIndex.push({
            sitename: site.sitename || '', site, marker, lat, lng, complete: false,
          });
        }
      });
    };

    // First render with no activity data (all complete Kitsap sites subdued)
    renderMarkers();
    if (loadingEl) loadingEl.style.display = 'none';

    // Then check recent activity and re-render with active sites highlighted
    if (rankableIds.length) {
      activeSet = await getActiveHotspots(rankableIds);
      renderMarkers();
    }
  },
  error: err => {
    console.error('CSV error:', err);
    const loadingEl = document.getElementById('map-loading');
    if (loadingEl) loadingEl.innerHTML = '<span>Could not load sites. Please refresh.</span>';
  },
});

// ─────────────────────────────────────────────
//  SITE SEARCH (type-ahead)
// ─────────────────────────────────────────────
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchClear   = document.getElementById('search-clear');

function runSearch(query) {
  const q = query.trim().toLowerCase();
  searchClear.style.display = q ? '' : 'none';

  if (!q) {
    searchResults.style.display = 'none';
    searchResults.innerHTML = '';
    return;
  }

  // Match against site name, area, and description.
  // Sort priority: name-starts-with > name-contains > area/description match.
  const matches = searchIndex
    .map(item => {
      const name = item.sitename.toLowerCase();
      const area = (item.site.area || '').toLowerCase();
      const desc = (item.site.desc || '').toLowerCase();
      let rank = null;
      if (name.startsWith(q))      rank = 0;
      else if (name.includes(q))   rank = 1;
      else if (area.includes(q))   rank = 2;
      else if (desc.includes(q))   rank = 3;
      return rank === null ? null : { item, rank };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.item.sitename.localeCompare(b.item.sitename);
    })
    .slice(0, 8)
    .map(m => m.item);

  if (!matches.length) {
    searchResults.innerHTML = '<li class="search-no-result">No matching sites</li>';
    searchResults.style.display = '';
    return;
  }

  searchResults.innerHTML = '';
  matches.forEach(item => {
    const li = document.createElement('li');
    li.className = 'search-result-item';

    // Highlight the matched portion of the name if the query is in the name;
    // otherwise show the name plain (the match was on area/description).
    const name = item.sitename;
    const idx  = name.toLowerCase().indexOf(q);
    let nameHtml;
    if (idx >= 0) {
      nameHtml = `${name.slice(0, idx)}<mark>${name.slice(idx, idx + q.length)}</mark>${name.slice(idx + q.length)}`;
    } else {
      nameHtml = name;
    }

    const area = item.site.area ? `<span class="search-result-area">${item.site.area}</span>` : '';
    const soon = !item.complete ? '<span class="search-result-soon">coming soon</span>' : '';

    li.innerHTML = `
      <span class="search-result-name">${nameHtml}</span>
      ${area}${soon}`;

    li.addEventListener('click', () => selectSearchResult(item));
    searchResults.appendChild(li);
  });
  searchResults.style.display = '';
}

function selectSearchResult(item) {
  searchInput.value = item.sitename;
  searchResults.style.display = 'none';

  // Pan/zoom the map to the site
  const targetZoom = Math.max(map.getZoom(), 14);
  map.setView([item.lat, item.lng], targetZoom, { animate: true });

  // Open its detail panel if it's a complete site; otherwise just show tooltip
  if (item.complete) {
    activeMarker = item.marker;
    openPanel(item.site);
  } else {
    item.marker.openTooltip();
  }

  // On mobile, blur the input so the keyboard closes
  searchInput.blur();
}

searchInput.addEventListener('input', (e) => runSearch(e.target.value));

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const first = searchResults.querySelector('.search-result-item');
    if (first) first.click();
  }
  if (e.key === 'Escape') {
    searchInput.value = '';
    runSearch('');
    searchInput.blur();
  }
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  runSearch('');
  searchInput.focus();
});

// Close results when clicking outside the search box
document.addEventListener('click', (e) => {
  if (!document.getElementById('site-search').contains(e.target)) {
    searchResults.style.display = 'none';
  }
});

// ─────────────────────────────────────────────
//  INFO MODAL
// ─────────────────────────────────────────────
const infoBtn        = document.getElementById('info-btn');
const infoModal      = document.getElementById('info-modal');
const infoModalClose = document.getElementById('info-modal-close');
const infoBackdrop   = infoModal.querySelector('.info-modal-backdrop');

function openInfoModal() {
  infoModal.classList.add('open');
  infoModal.setAttribute('aria-hidden', 'false');
}
function closeInfoModal() {
  infoModal.classList.remove('open');
  infoModal.setAttribute('aria-hidden', 'true');
}

infoBtn.addEventListener('click', openInfoModal);
infoModalClose.addEventListener('click', closeInfoModal);
infoBackdrop.addEventListener('click', closeInfoModal);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && infoModal.classList.contains('open')) closeInfoModal();
});

// ─────────────────────────────────────────────
//  FOOTER YEAR
// ─────────────────────────────────────────────
document.getElementById('footer-year').textContent = new Date().getFullYear();