/**
 * Kitsap Audubon – Where to Bird Map
 * main.js
 */

const CSV_PATH      = 'sites.csv';
const MAP_CENTER    = [47.70, -122.68];
const MAP_ZOOM      = 10;
const EBIRD_API_KEY = 'tjd5dj8076eb';
const EBIRD_BASE    = 'https://api.ebird.org/v2';

// ─────────────────────────────────────────────
//  MAP INIT
// ─────────────────────────────────────────────
const map = L.map('map', {
  center: MAP_CENTER,
  zoom: MAP_ZOOM,
  zoomControl: true,
});

// ESRI World Light Gray — free, no key, no account
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
  maxZoom: 16,
}).addTo(map);

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
           <img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQEc6eX9tIp0WmvgsaFXh_ePJUSql6dw09ZVA&s" alt="" />
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

// Kitsap County eBird region code
const KITSAP_REGION = 'US-WA-035';

// Layer group for rarities
const rarityLayer  = L.layerGroup();
let rarityLayerOn  = false;
let layerDays      = 7;
let rarityCache    = { data: null, days: null };

// ─────────────────────────────────────────────
//  RARITIES DRAWER
// ─────────────────────────────────────────────
const raritiesDrawer = document.getElementById('rarities-drawer');

function openRaritiesDrawer() {
  raritiesDrawer.classList.add('open');
  raritiesDrawer.setAttribute('aria-hidden', 'false');
}

function closeRaritiesDrawer() {
  raritiesDrawer.classList.remove('open');
  raritiesDrawer.setAttribute('aria-hidden', 'true');
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
        map.setView([obs.lat, obs.lng], 13, { animate: true });
        // Find and open the matching rarity marker popup
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
  <div class="layer-toggle-group">
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
let activeTab      = 'rarities';

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

async function loadEbird(hotspotId, days) {
  eBirdLoading.style.display = '';
  eBirdContent.style.display = 'none';
  eBirdNone.style.display    = 'none';
  try {
    const { recent, notable } = await fetchEbird(hotspotId, days);
    renderEbird(recent, notable);
    eBirdLink.href          = `https://ebird.org/hotspot/${hotspotId}`;
    eBirdLink.style.display = '';
  } catch (err) {
    console.error('eBird fetch failed:', err);
    eBirdNone.style.display = '';
  } finally {
    eBirdLoading.style.display = 'none';
  }
}


// ─────────────────────────────────────────────
//  PANEL OPEN / CLOSE
// ─────────────────────────────────────────────
function openPanel(site) {
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
    loadEbird(hotspotId, activeDays);
  } else {
    currentHotspot = null;
    sectionEbird.style.display = 'none';
  }

  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  panel.scrollTop = 0;
  panel.focus();
}

function closePanel() {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
  currentHotspot = null;
  activeMarker   = null;
}

panelClose.addEventListener('click', closePanel);
map.on('click', closePanel);

// ─────────────────────────────────────────────
//  LOAD CSV
// ─────────────────────────────────────────────
Papa.parse(CSV_PATH, {
  download: true,
  header: true,
  skipEmptyLines: true,
  complete: ({ data: sites }) => {
    if (!sites.length) return;

    sites.forEach(site => {
      const lat = parseFloat(site.lat);
      const lng = parseFloat(site.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      const isComplete = (site.complete || '').trim() === 'x';

      if (isComplete) {
        // Full kingfisher marker — opens detail panel on click
        const marker = L.marker([lat, lng], { icon: birdIcon })
          .addTo(map)
          .bindTooltip(site.sitename || '', {
            permanent: false, direction: 'top',
            className: 'site-tooltip', offset: [0, -28],
          });
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          activeMarker = marker;
          openPanel(site);
        });
      } else {
        // Grey dot — shows name tooltip only, no panel
        L.marker([lat, lng], { icon: incompleteIcon })
          .addTo(map)
          .bindTooltip(`${site.sitename || 'Unnamed site'} <span class="tooltip-coming-soon">coming soon</span>`, {
            permanent: false, direction: 'top',
            className: 'site-tooltip site-tooltip--incomplete',
            offset: [0, -8],
          });
      }
    });
  },
  error: err => console.error('CSV error:', err),
});

// ─────────────────────────────────────────────
//  FOOTER YEAR
// ─────────────────────────────────────────────
document.getElementById('footer-year').textContent = new Date().getFullYear();