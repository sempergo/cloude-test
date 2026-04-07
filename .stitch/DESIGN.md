# Design System: BKK Thai Street Food

## 1. Visual Theme & Atmosphere

**Bangkok bei Nacht.** Eine dunkle, atmosphärische Restaurantseite die sich anfühlt wie das Innere eines coolen urbanen Lokals in Bangkok — kurz vor Mitternacht. Nicht traditionell, nicht Klischee-Thai. Die Seite hat die Energie einer Stadt, die nie schläft: reich, komplex, warm durch Kerzenlicht und rote Akzente, aber mit der Ruhe eines Ortes, der weiß wie gut er ist.

- **Density:** 5 — Ausgewogen. Großzügiges Whitespace neben dichten Foto-Momenten.
- **Variance:** 7 — Asymmetrisch. Kein einziges symmetrisches gleichwertiges Layout.
- **Motion:** 6 — Fluid. Scroll-Reveals, staggered Text, subtile Parallax. Kein Overload.
- **Mood Keywords:** Cinematic, editorial, nocturnal, warm-dark, confident, sensual, honest.

---

## 2. Color Palette & Roles

- **Night Canvas** (`#0A0A08`) — Primärer Hintergrund. Fast-schwarz mit warmem Unterton. Nie pure black.
- **Deep Surface** (`#141410`) — Cards, Sections-Hintergrund. Leichte Erhebung über Canvas.
- **Ember Surface** (`#1C1A14`) — Hover-States, aktive Bereiche. Warmer Kohle-Ton.
- **Warm Ivory** (`#F2EDE4`) — Primärer Text. Off-white, niemals reines Weiß.
- **Muted Sand** (`#9E9A8E`) — Sekundärer Text, Labels, Metadaten.
- **Ghost Border** (`rgba(242, 237, 228, 0.08)`) — Card-Borders, strukturelle Linien. Kaum sichtbar.
- **BKK Red** (`#D41A1A`) — Einziger Akzent. CTAs, aktive Zustände, Logo-Kontext, Hover-Highlights.
- **Ember Gold** (`#C49A3C`) — Warmth-Akzent für Food/Wine Kontext. Sparsam — nur dekorativ oder für Weinbereich.

**Verboten:** Kein reines `#000000`. Kein Neon. Kein Blau. Kein helles Thai-Restaurant-Layout. Kein Gold-Drachen-Vibe.

---

## 3. Typography Rules

- **Display / Headlines:** **Syne** (700, 800) — Geometrisch-bold, modern. Tight tracking (`letter-spacing: -0.02em`). Skalierung via `clamp()`. Hierarchie durch Gewicht und Farbe.
- **Body:** **DM Sans** (300, 400, 500) — Clean, modern, sehr lesbar. Line-height 1.65. Max 65 Zeichen pro Zeile. Muted Sand für Sekundärtext.
- **Labels / Kategorien:** **DM Sans** 500 Uppercase, letter-spacing 0.1em — für Section-Labels, kleine Metadaten.
- **Scale:** Headlines `clamp(48px, 10vw, 120px)` → Section Titles `clamp(28px, 5vw, 56px)` → Body `16px/1.65` → Labels `12px uppercase`
- **Google Fonts Import:**
  ```css
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500&display=swap');
  ```

**Verboten:** Inter. Georgia. Times New Roman. Gradient-Text auf großen Headlines.

---

## 4. Component Stylings

- **Buttons (Primary):** BKK Red Hintergrund (`#D41A1A`), Warm Ivory Text. Sharp Corners (4px max). `-1px translateY` auf active. `150ms ease-out`. Kein Outer Glow.
- **Buttons (Ghost):** 1px Border `rgba(242, 237, 228, 0.25)`, transparent. Hover: Border und Text `#F2EDE4` voll.
- **Cards:** Dark Surface (`#141410`), 1px Ghost Border. Box-shadow `0 4px 32px rgba(0,0,0,0.5)`. Hover: `scale(1.01)` + leichte Helligkeit. Max 12px border-radius.
- **Nav:** Transparent auf Hero, solid `rgba(10,10,8,0.95)` beim Scroll mit `backdrop-filter: blur(12px)`. Logo links, Links rechts, CTA ganz rechts. Mobile: Hamburger → Full-Screen Overlay.
- **Food Photo Containers:** Full-bleed, `object-fit: cover`. Gradient-Overlay unten (`rgba(10,10,8,0)` → `rgba(10,10,8,0.7)`) für Lesbarkeit. Kein weißer Rand.
- **Review Cards:** Minimal — kein schwerer Box-Shadow. Ghost Border genügt. Zitat groß, Name klein in Muted Sand.
- **Dividers:** Nie sichtbare HR. Stattdessen negatives Space oder Ghost Border.

---

## 5. Layout Principles

- **Mobile-First.** Alle Multi-Column Layouts kollabieren unter 768px zu Single Column. Null horizontales Scrollen.
- **Asymmetrisch.** Kein zentrierter Hero. Kein gleichwertiges 3-Spalten-Grid. Bevorzuge: Left-aligned Headlines, Split-Screen 60/40, Offset-Grids.
- **CSS Grid** over Flexbox-Math. Kein `calc()`. Max-width Container: `1400px centered`.
- **Fullscreen Sections:** `min-height: 100dvh`. Vertikaler Spacing via `clamp(4rem, 8vw, 8rem)`.
- **Sections Reihenfolge:** Hero → Story (1974 + BKK 2020) → Speisekarte CTA → Social Proof (Reviews) → Wein-Moment → Öffnungszeiten + Reservation → Footer
- **Foto-First:** Bilder sind die Stars. Kein Content der Fotos überlagert.

---

## 6. Motion & Interaction

- **Engine:** Motion CDN (`motion@latest`) + Lenis Smooth Scroll (`lenis@latest`)
- **Init:**
  ```js
  const lenis = new Lenis();
  lenis.on('scroll', Motion.scroll);
  function raf(time) { lenis.raf(time); requestAnimationFrame(raf); }
  requestAnimationFrame(raf);
  ```
- **Scroll-Reveals:** Alle Blöcke starten `opacity: 0, translateY: 30px`. Reveal beim Viewport-Eintritt. `duration: 0.6s, easing: [0.16, 1, 0.3, 1]`.
- **Staggered Text:** Headlines Wort-für-Wort. Cascade-Delay `0.08s` pro Element.
- **Hover Fotos:** `scale(1.03)` auf `img` (nicht Container). `200ms ease`.
- **Kein Animate:** Nie `width`, `height`, `top`, `left` — nur `transform` + `opacity`.
- **Reduced Motion:** `@media (prefers-reduced-motion: reduce)` → alle Durations auf `0.01ms`.

---

## 7. Anti-Patterns (Verboten)

- Kein Gold-Drachen, Thai-Tempel oder Lotus-Klischee in Design oder Text
- Kein helles Restaurant-Template (weißer Hintergrund, bunte Kacheln)
- Kein Inter Font
- Kein reines `#000000` oder `#ffffff`
- Kein Neon-Glow, kein farbiger Box-Shadow auf Buttons
- Kein 3-Spalten gleichwertiges Feature-Grid
- Kein zentrierter Hero-Layout
- Kein "Lorem ipsum" oder Placeholder-Content
- Kein "Scroll to explore" oder Scroll-Pfeil-Bounce
- Keine Emojis als Icons
- Keine KI-Copywriting-Klischees: "Erleben Sie", "Entdecken Sie", "Authentisch wie nie zuvor", "Einzigartig"
- Keine erfundenen Statistiken oder Metriken
- Keine Unsplash-Bilder — echte BKK-Fotos verwenden
- Kein Custom Mouse Cursor
- Keine überlappenden Elemente
