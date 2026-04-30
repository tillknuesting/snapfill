# Third-Party Licenses

Every dependency below permits commercial use (including charging users for the
hosted product) and redistribution. None are copyleft. The relevant retention
requirements are noted at the bottom.

## Runtime libraries

| Package | License |
|---|---|
| react, react-dom | MIT |
| zustand | MIT |
| pdfjs-dist | Apache 2.0 |
| pdf-lib | MIT |
| @pdf-lib/fontkit | MIT |
| @radix-ui/react-* | MIT |
| radix-ui (meta) | MIT |
| @tailwindcss/vite | MIT |
| tailwindcss | MIT |
| tailwindcss-animate | MIT |
| tailwind-merge | MIT |
| class-variance-authority | Apache 2.0 |
| clsx | MIT |
| lucide-react | ISC |
| shadcn/ui (copied components) | MIT |

## Build / dev

| Package | License |
|---|---|
| vite | MIT |
| @vitejs/plugin-react | MIT |
| typescript | Apache 2.0 |
| eslint, typescript-eslint, eslint-plugin-react-* | MIT |
| globals | MIT |
| @types/* | MIT |
| @eslint/js | MIT |
| wrangler (Cloudflare CLI) | MIT or Apache 2.0 |

## Fonts (loaded from Google Fonts at runtime)

| Font | License |
|---|---|
| Architects Daughter | Apache 2.0 |
| Caveat | SIL Open Font License 1.1 |
| Coming Soon | Apache 2.0 |
| Homemade Apple | Apache 2.0 |
| Indie Flower | Apache 2.0 |
| Just Another Hand | Apache 2.0 |
| Kalam | SIL Open Font License 1.1 |
| Patrick Hand | SIL Open Font License 1.1 |
| Reenie Beanie | Apache 2.0 |
| Shadows Into Light | SIL Open Font License 1.1 |

OFL allows commercial use, including bundling fonts in commercial software.
The only restriction is that you can't sell the font *files* themselves as
your standalone product — which we don't (we render glyphs to a canvas and
embed the rendered PNG into the user's PDF).

## What you must do to comply

- **MIT / BSD / ISC** — keep the copyright notice and license text when
  redistributing source. For a hosted SaaS this typically means leaving the
  notices in `node_modules/` license files or shipping a notices file.
- **Apache 2.0** — same as MIT, plus include the `NOTICE` file from the
  upstream package if one exists (e.g. pdfjs-dist ships a `LICENSE` only;
  TypeScript ships an `Apache LICENSE`). State significant modifications.
- **OFL fonts** — when redistributing the font *file*, keep the OFL and the
  reserved font name. We load fonts from Google Fonts CDN at runtime, so we
  aren't redistributing the files ourselves.

If you publish a public site, a single attribution page (or footer link)
listing the libraries above and pointing to their license texts is the simple
way to satisfy all of this.
