# Kitsap Audubon – Birding Sites Map

## File Structure

```
birding-map/
├── index.html      ← Main page
├── main.js         ← Map logic, CSV loading, panel behavior
├── style.css       ← All styles
├── sites.csv       ← Your birding site data (edit this!)
└── README.md       ← This file
```

---

## Editing `sites.csv`

Each row is one birding site. Columns:

| Column             | Description                                                                 |
|--------------------|-----------------------------------------------------------------------------|
| `id`               | Unique number for each site                                                 |
| `name`             | Display name of the site                                                    |
| `lat`              | Latitude (decimal degrees)                                                  |
| `lng`              | Longitude (decimal degrees)                                                 |
| `description`      | Text shown in the detail panel                                              |
| `ebird_hotspot_id` | eBird location ID (e.g. `L270425`) — find it in the eBird hotspot URL       |
| `photos`           | Pipe-separated (`|`) list of image URLs or relative paths                   |

**Finding the eBird hotspot ID:**  
Go to ebird.org → Explore → Hotspots → search your site → the ID is in the URL:  
`https://ebird.org/hotspot/L270425` → ID is `L270425`

**Photos:**  
- To use local images, put them in an `images/` folder and use relative paths:  
  `images/point-no-point-1.jpg|images/point-no-point-2.jpg`
- To use web-hosted images, paste the full URL.

---

## Running Locally

Because the page fetches `sites.csv` via `fetch()`, you need a local server
(browsers block file:// fetch requests).

**Easiest options:**

```bash
# Python 3
python -m http.server 8000
# then open http://localhost:8000

# Node (npx)
npx serve .
```

---

## Map Tiles

The map uses free OpenStreetMap tiles — no API key needed. If you want a
more styled map, you can swap the tile URL in `main.js`:

```js
// Stadia Alidade Smooth (free, requires account for high traffic)
L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}{r}.png', { ... })
```

---

## Customization Tips

- **Logo:** Replace the inline SVG bird in `index.html` with an `<img>` tag pointing to the Kitsap Audubon logo.
- **Colors:** All colors are CSS variables at the top of `style.css`.
- **Fonts:** Uses Google Fonts (Playfair Display + Source Sans 3). Change in the `<link>` tag in `index.html` and in `style.css`.
- **Panel width:** Adjust `--panel-w` in the `:root` block of `style.css`.
