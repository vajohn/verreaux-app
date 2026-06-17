# Verreaux (React + TypeScript + Vite)

## Source URL & updates

Series can be added or refreshed directly from their source page by driving the
Pi scraper over HTTP — alongside the existing "import a ZIP" path. Each series
stores a `sourceUrl`; updates fetch only chapters newer than what's already in
the library.

**Configure the Pi API** — in Settings, set **Pi scraper API URL** to the Pi
service (LAN `http://pajohn.local:8080`, or its Tailscale Funnel HTTPS URL for
off-network use). All scrape/update calls require a 6-digit TOTP code from your
authenticator (the same secret the Pi's `SCRAPE_TOTP_SECRET` was generated from).

**Add from URL** — Library → "Add from URL": paste a series URL + OTP. The app
asks the Pi to scrape the full series, downloads the resulting ZIP, and imports
it like any other. The ZIP's embedded `verreaux.json` records the source URL, so
the new series is immediately updatable.

**Set source URL (back-fill)** — Series screen → overflow → "Set source URL".
Attaches a source to a series that has none (e.g. anything imported before this
feature, or from a manifest-less ZIP), which unlocks updates for it.

**Update from source** — Series screen → overflow → "Update from source" (shown
only when a source URL is set). Scrapes from one past the highest chapter you
already have through the latest, and merges the new chapters in by order —
existing chapters are left untouched.

> Requires the Pi scraper service (the `verreaux-scraper` repo) to be running
> and reachable. See that repo's README for the Pi/Docker setup.

---

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
