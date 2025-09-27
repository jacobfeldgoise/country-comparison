# Country Comparison

An interactive React application for comparing countries side by side using the latest figures from the World Bank. A responsive world map drives the experience: click two countries (or use the search box) to populate a comparison table that highlights absolute and percentage differences across economic, demographic, and sustainability indicators. The map can be recolored by any metric, making it easy to spot regional patterns at a glance.

![Screenshot of the Country Comparator interface showing a choropleth map, country comparison panel, and metrics table.](public/country-comparator.png)

## Features

- **Interactive world map** powered by [react-simple-maps](https://www.react-simple-maps.io/) and D3, with smooth zooming, panning, reset controls, and accessible keyboard navigation.
- **Live World Bank data** fetched on demand (and revalidated daily) for population, GDP, life expectancy, emissions, unemployment, inflation, trade, renewables, and more.
- **Two-country comparison workflow** with quick select, swap, and clear actions plus a searchable list of 200+ countries.
- **Smart coloring and legends** that support quantile (quintile buckets) or continuous linear scales so you can choose the best representation for each indicator.
- **Insightful comparison table** that formats values for readability, flags older data, and shows both absolute and percentage deltas.

## Tech Stack

- [React 19](https://react.dev/) + [Vite](https://vitejs.dev/) for the application shell and build tooling.
- [Tailwind CSS 4](https://tailwindcss.com/) for utility-first styling.
- [react-simple-maps](https://www.react-simple-maps.io/) and [d3-geo](https://github.com/d3/d3-geo) for map rendering.
- [Lucide](https://lucide.dev/) for icons.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) **18.0.0 or newer** (LTS recommended).
- npm (bundled with Node). PNPM/Yarn will work, but the npm scripts below are assumed.

### Installation

```bash
npm install
```

### Run the development server

```bash
npm run dev
```

This starts Vite on the default port (usually `5173`). The app hot-reloads when you edit files in `src/`.

### Lint the project

```bash
npm run lint
```

### Create a production build

```bash
npm run build
```

### Preview the production build locally

```bash
npm run preview
```

## Data sources & refresh strategy

- **World Bank Open Data API** – Indicator series are fetched for each metric with `MRV=10`, allowing the app to grab the most recent non-null value (typically within the last decade). Results are cached in `localStorage` with a 24-hour TTL to reduce API calls.
- **Natural Earth** – Country borders are bundled as `public/data/world-countries.geojson` and loaded at runtime for map rendering.

If data fails to load you will see an inline error banner. Clearing browser storage forces the app to refetch everything.

## Project structure

```
├── public/
│   └── data/world-countries.geojson   # GeoJSON boundaries shipped with the app
├── src/
│   ├── App.jsx                        # Main application logic and UI components
│   ├── assets/                        # Static assets imported at build time
│   ├── index.css                      # Tailwind entrypoint
│   └── main.jsx                       # React entry point
├── index.html                         # Vite HTML template
├── package.json                       # Scripts and dependencies
└── vite.config.js                     # Vite configuration
```

## Deployment notes

- `npm run build` outputs a static bundle in `dist/`. Serve the folder via any static host (Netlify, Vercel, GitHub Pages, etc.).
- The application talks directly to the World Bank API from the browser, so no server-side secrets are required.
- Ensure the deployment origin is allowed to make outbound HTTPS requests; otherwise live data will fail to load.

## Contributing

1. Fork and clone the repository.
2. Create a feature branch.
3. Make your changes and run `npm run lint`.
4. Commit, push, and open a pull request describing your changes.

Bug reports and feature ideas are welcome—please include reproduction steps or sketches when applicable.

## License

This project is released under the [MIT License](./LICENSE).
