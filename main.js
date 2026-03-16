/**
 * Kitsap Audubon – Birding Sites Map
 * main.js
 *
 * CSV columns: id, area, sitename, desc, link, lat, lng, ebird_hotspot_id, photos
 * photos = pipe-separated relative paths, e.g.: data/img/site-1.jpg|data/img/site-2.jpg
 * ebird_hotspot_id = eBird location ID, e.g. L109542
 */

// ─────────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────────
const CSV_PATH      = 'sites.csv';
const MAP_CENTER    = [47.70, -122.68];
const MAP_ZOOM      = 10;
const EBIRD_API_KEY = 'tjd5dj8076eb';
const EBIRD_BASE    = 'https://api.ebird.org/v2';

// Species considered "iconic" for Kitsap-area birding
// (used to flag notable sightings from the recent list)
const ICONIC_SPECIES = new Set([
  'Belted Kingfisher','Bald Eagle','Osprey','Peregrine Falcon',
  'Rhinoceros Auklet','Marbled Murrelet','Ancient Murrelet',
  'Common Loon','Pacific Loon','Red-throated Loon',
  'Horned Grebe','Red-necked Grebe','Western Grebe',
  'Pigeon Guillemot','Common Murre','Tufted Puffin',
  'Harlequin Duck','Long-tailed Duck','Surf Scoter',
  'White-winged Scoter','Black Scoter',
  'Hooded Merganser','Red-breasted Merganser','Common Merganser',
  'Pied-billed Grebe','American Bittern',
  "Heermann's Gull","Bonaparte's Gull",
  'Parasitic Jaeger','Pomarine Jaeger',
  'Red-necked Phalarope','Sanderling',
  'Pileated Woodpecker','Varied Thrush',
  'Common Redpoll','Pine Siskin',
  'Snow Goose','Trumpeter Swan','Tundra Swan',
]);

// ─────────────────────────────────────────────
//  MAP INIT
// ─────────────────────────────────────────────
const map = L.map('map', {
  center: MAP_CENTER,
  zoom: MAP_ZOOM,
  zoomControl: true,
});

// CartoDB Positron — clean, light, no API key required
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20,
}).addTo(map);

// Fix Leaflet default icon 401 errors when hosted on GitHub Pages
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom marker icon
const birdIcon = L.divIcon({
  className: 'bird-marker',
  html: `<div class="marker-pin">
           <img src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQEc6eX9tIp0WmvgsaFXh_ePJUSql6dw09ZVA&s" alt="birding site" />
         </div>`,
  iconSize: [44, 44],
  iconAnchor: [22, 44],
  popupAnchor: [0, -46],
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
const listNotable    = document.getElementById('list-notable');
const listHighcount  = document.getElementById('list-highcount');
const listRecent     = document.getElementById('list-recent');
const blockRarities  = document.getElementById('block-rarities');
const blockNotable   = document.getElementById('block-notable');
const blockHighcount = document.getElementById('block-highcount');
const blockRecent    = document.getElementById('block-recent');

// ─────────────────────────────────────────────
//  SLIDESHOW
// ─────────────────────────────────────────────
let currentSlide = 0;
let slideImages  = [];
let activeMarker = null;

function buildSlideshow(photos) {
  slideshow.innerHTML = '';
  slideDots.innerHTML = '';
  slideImages  = photos;
  currentSlide = 0;

  photos.forEach((src, i) => {
    const img = document.createElement('img');
    img.src       = src;
    img.alt       = `Site photo ${i + 1}`;
    img.className = 'slide-img' + (i === 0 ? ' active' : '');
    img.loading   = 'lazy';
    slideshow.appendChild(img);

    const dot = document.createElement('button');
    dot.className = 'dot' + (i === 0 ? ' active' : '');
    dot.setAttribute('aria-label', `Go to photo ${i + 1}`);
    dot.addEventListener('click', () => goToSlide(i));
    slideDots.appendChild(dot);
  });

  const showNav = photos.length > 1;
  prevBtn.style.display = showNav ? '' : 'none';
  nextBtn.style.display = showNav ? '' : 'none';
  slideDots.style.display = showNav ? '' : 'none';
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
//  EBIRD API
// ─────────────────────────────────────────────
function eBirdHeaders() {
  return { 'X-eBirdApiToken': EBIRD_API_KEY };
}

async function fetchEbird(hotspotId) {
  const since = 30; // days back for recent/high-count queries

  const [recentRes, notableRes] = await Promise.all([
    fetch(`${EBIRD_BASE}/data/obs/${hotspotId}/recent?maxResults=50&back=${since}`,
      { headers: eBirdHeaders() }),
    fetch(`${EBIRD_BASE}/data/obs/${hotspotId}/recent/notable?maxResults=20&back=${since}`,
      { headers: eBirdHeaders() }),
  ]);

  const recent  = recentRes.ok  ? await recentRes.json()  : [];
  const notable = notableRes.ok ? await notableRes.json() : [];

  return { recent, notable };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  // dateStr from eBird is "YYYY-MM-DD HH:mm"
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildEbirdLi(obs, badge) {
  const li = document.createElement('li');
  li.className = 'ebird-item';

  const count = obs.howMany ? `<span class="obs-count">${obs.howMany.toLocaleString()}</span>` : '';
  const date  = `<span class="obs-date">${formatDate(obs.obsDt)}</span>`;
  const name  = `<span class="obs-name">${obs.comName}</span>`;
  const sci   = `<span class="obs-sci">${obs.sciName}</span>`;
  const bdg   = badge ? `<span class="obs-badge ${badge.cls}">${badge.label}</span>` : '';

  li.innerHTML = `${bdg}${name} ${sci} ${count} ${date}`;
  return li;
}

function renderEbird(recent, notable) {
  // --- Rarities (notable endpoint) ---
  listRarities.innerHTML = '';
  if (notable.length) {
    notable.slice(0, 8).forEach(obs => {
      listRarities.appendChild(buildEbirdLi(obs, { label: 'Rare', cls: 'badge-rare' }));
    });
    blockRarities.style.display = '';
  } else {
    blockRarities.style.display = 'none';
  }

  // --- Iconic/Notable species from recent list ---
  listNotable.innerHTML = '';
  const iconicObs = recent.filter(o => ICONIC_SPECIES.has(o.comName));
  // deduplicate by species
  const seenIconic = new Set();
  const iconicDedup = iconicObs.filter(o => {
    if (seenIconic.has(o.speciesCode)) return false;
    seenIconic.add(o.speciesCode);
    return true;
  });

  if (iconicDedup.length) {
    iconicDedup.slice(0, 8).forEach(obs => {
      listNotable.appendChild(buildEbirdLi(obs, { label: '⭐', cls: 'badge-notable' }));
    });
    blockNotable.style.display = '';
  } else {
    blockNotable.style.display = 'none';
  }

  // --- High counts: sort by howMany descending ---
  listHighcount.innerHTML = '';
  const withCounts = recent.filter(o => o.howMany && o.howMany > 1);
  withCounts.sort((a, b) => b.howMany - a.howMany);
  const seenCount = new Set();
  const topCounts = withCounts.filter(o => {
    if (seenCount.has(o.speciesCode)) return false;
    seenCount.add(o.speciesCode);
    return true;
  }).slice(0, 8);

  if (topCounts.length) {
    topCounts.forEach(obs => {
      listHighcount.appendChild(buildEbirdLi(obs, null));
    });
    blockHighcount.style.display = '';
  } else {
    blockHighcount.style.display = 'none';
  }

  // --- Recent: most recent 8, deduped by species ---
  listRecent.innerHTML = '';
  const seenRecent = new Set();
  const recentDedup = recent.filter(o => {
    if (seenRecent.has(o.speciesCode)) return false;
    seenRecent.add(o.speciesCode);
    return true;
  }).slice(0, 8);

  if (recentDedup.length) {
    recentDedup.forEach(obs => {
      listRecent.appendChild(buildEbirdLi(obs, null));
    });
    blockRecent.style.display = '';
  } else {
    blockRecent.style.display = 'none';
  }

  // Show/hide whole content area
  const hasAny = notable.length || iconicDedup.length || topCounts.length || recentDedup.length;
  eBirdContent.style.display = hasAny ? '' : 'none';
  eBirdNone.style.display    = hasAny ? 'none' : '';
}

async function loadEbird(hotspotId) {
  eBirdLoading.style.display  = '';
  eBirdContent.style.display  = 'none';
  eBirdNone.style.display     = 'none';
  eBirdLink.style.display     = 'none';

  try {
    const { recent, notable } = await fetchEbird(hotspotId);
    renderEbird(recent, notable);
    eBirdLink.href           = `https://ebird.org/hotspot/${hotspotId}`;
    eBirdLink.style.display  = '';
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
  // Title + area
  panelTitle.textContent = site.sitename || site.name || 'Unnamed Site';
  panelArea.textContent  = site.area     || '';

  // Description
  const description = site.desc || site.description || '';
  panelDesc.textContent = description;
  document.getElementById('section-desc').style.display = description ? '' : 'none';

  // Get Directions button
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
  const rawPhotos = site.photos || '';
  const photos = rawPhotos.split('|').map(s => s.trim()).filter(Boolean);
  if (photos.length) {
    buildSlideshow(photos);
    slideshowWrap.style.display = '';
  } else {
    slideshowWrap.style.display = 'none';
  }

  // YouTube video
  const sectionVideo = document.getElementById('section-video');
  const youtubeWrap  = document.getElementById('youtube-wrap');
  const youtubeId    = (site.youtube_id || '').trim();
  if (youtubeId && !youtubeId.startsWith('PLACEHOLDER')) {
    youtubeWrap.innerHTML = `
      <iframe
        src="https://www.youtube.com/embed/${youtubeId}"
        title="How to bird at ${site.sitename}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        loading="lazy">
      </iframe>`;
    sectionVideo.style.display = '';
  } else {
    sectionVideo.style.display = 'none';
  }

  // Accessibility
  const sectionAccess = document.getElementById('section-access');
  const accessContent = document.getElementById('access-content');
  const accessText = (site.accessibility || '').trim();
  if (accessText && !accessText.startsWith('PLACEHOLDER')) {
    accessContent.textContent = accessText;
  } else {
    accessContent.innerHTML = `
      <ul class="access-list">
        <li><span class="access-icon">🅿️</span> <span class="access-label">Parking:</span> PLACEHOLDER</li>
        <li><span class="access-icon">♿</span> <span class="access-label">Wheelchair Access:</span> PLACEHOLDER</li>
        <li><span class="access-icon">🚻</span> <span class="access-label">Restrooms:</span> PLACEHOLDER</li>
        <li><span class="access-icon">🥾</span> <span class="access-label">Terrain:</span> PLACEHOLDER</li>
        <li><span class="access-icon">🐕</span> <span class="access-label">Dogs Allowed:</span> PLACEHOLDER</li>
      </ul>`;
  }
  sectionAccess.style.display = '';

  // eBird
  const hotspotId = (site.ebird_hotspot_id || '').trim();
  const sectionEbird = document.getElementById('section-ebird');
  if (hotspotId && !hotspotId.startsWith('PLACEHOLDER')) {
    sectionEbird.style.display = '';
    loadEbird(hotspotId);
  } else {
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
  if (activeMarker) { activeMarker = null; }
}

panelClose.addEventListener('click', closePanel);
map.on('click', closePanel);

// ─────────────────────────────────────────────
//  LOAD CSV + PLACE MARKERS
// ─────────────────────────────────────────────
Papa.parse(CSV_PATH, {
  download: true,
  header: true,
  skipEmptyLines: true,
  complete: ({ data: sites }) => {
    if (!sites.length) { console.warn('No sites found in CSV.'); return; }

    sites.forEach((site) => {
      const lat = parseFloat(site.lat);
      const lng = parseFloat(site.lng);

      if (isNaN(lat) || isNaN(lng)) {
        console.warn(`Skipping "${site.sitename}" — invalid coordinates.`);
        return;
      }

      const marker = L.marker([lat, lng], { icon: birdIcon })
        .addTo(map)
        .bindTooltip(site.sitename || site.name, {
          permanent: false,
          direction: 'top',
          className: 'site-tooltip',
          offset: [0, -30],
        });

      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        activeMarker = marker;
        openPanel(site);
      });
    });
  },
  error: (err) => console.error('Failed to load sites.csv:', err),
});

// ─────────────────────────────────────────────
//  FOOTER YEAR
// ─────────────────────────────────────────────
document.getElementById('footer-year').textContent = new Date().getFullYear();
