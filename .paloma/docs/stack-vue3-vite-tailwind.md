# Stack Reference: Vue 3 + Vite + Tailwind CSS

> Verifesto Studios frontend standard. Use this for every client project.
>
> Historical note for Paloma: this is a generic client-project stack reference, not Paloma's exact build sheet. Paloma-specific deviations include `src/styles/main.css` instead of `src/style.css`, root-level Vite output (`dist/`), and a custom `no-full-reload` plugin in `vite.config.js` that blocks HMR full reloads.

---

## Scaffold

```bash
npm create vite@latest frontend -- --template vue
cd frontend
npm install
npm install -D tailwindcss @tailwindcss/vite
```

## Vite Config

```js
// vite.config.js
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
})
```

## Tailwind Entry

```css
/* src/style.css or src/styles/main.css */
@import "tailwindcss";
```

No `tailwind.config.js` needed — Tailwind v4 uses CSS-based configuration via `@theme`.

## Brand Tokens (Verifesto Standard)

```css
@theme {
  --color-ink: #0B1220;
  --color-ink-muted: #5B6475;
  --color-surface: #F7F8FA;
  --color-surface-2: #FFFFFF;
  --color-border: #E6E8EE;
  --color-verity: #2F6BFF;
  --color-verity-deep: #1F4FE0;
  --color-success: #16A34A;
  --color-warning: #F59E0B;
  --color-error: #DC2626;
  --color-gold: #C9A227;

  --font-display: 'Fraunces', serif;
  --font-body: 'Inter', sans-serif;
}
```

Adjust brand tokens per client. The pattern stays the same.

## Fonts (Google Fonts)

```html
<!-- index.html -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,100..900;1,9..144,100..900&family=Inter:wght@300..700&display=swap" rel="stylesheet">
```

## Standard Project Structure

```
frontend/
├── public/
├── src/
│   ├── assets/
│   ├── components/
│   │   └── [feature]/         # Group by feature, not by type
│   ├── composables/           # Shared reactive logic
│   │   └── use[Feature].js
│   ├── services/              # API clients, external integrations
│   │   └── api.js
│   ├── views/                 # Page-level components (if using router)
│   ├── App.vue
│   ├── main.js
│   └── style.css              # Tailwind imports + brand tokens
├── index.html
├── vite.config.js
└── package.json
```

## Key Conventions

- **Composables** use `use` prefix: `useAuth.js`, `useSchedule.js`
- **Components** use PascalCase: `ScheduleView.vue`, `ServiceTicketForm.vue`
- **Group by feature**, not by type (components/schedule/, not components/buttons/)
- **No global state library** unless needed — composables with module-level refs work great
- **Vue 3 Composition API** only — no Options API

## Deployment: Cloudflare Pages

1. Connect repo to Cloudflare Pages
2. Build config:
   - Framework preset: Vue
   - Build command: `npm run build`
  - Build output: `frontend/dist` for a nested frontend app, or `dist` for a root-level Vite app like Paloma
   - Root directory: `frontend`
3. Set env vars (e.g., `VITE_API_URL`)

## Common Dependencies

```bash
# Router (if multi-page)
npm install vue-router

# Date handling
npm install date-fns

# Icons (lightweight)
npm install lucide-vue-next
```

## Notes

- Tailwind v4 is CSS-first — use `@theme` blocks, not JS config
- Standard Vite HMR may full-reload on some config changes; Paloma overrides that with a custom `no-full-reload` plugin in `vite.config.js`
- For demo/prototype projects, skip the router — single-page with conditional rendering is faster to build
