# Design System: Semp Studios

## 1. Visual Theme & Atmosphere

A bold editorial interface built for a web agency that leads with craft and confidence. The atmosphere is like a high-end print magazine that learned to move — every element deliberate, nothing decorative for its own sake. Cream-warm background, off-black ink, a single electric-green accent that punctuates with precision.

- **Density:** 5/10 — Balanced. Generous breathing room in hero, tighter in feature sections
- **Variance:** 8/10 — Strongly asymmetric. Left-weighted layouts, staggered grids, no centering in heroes
- **Motion:** 7/10 — Cinematic but controlled. Spring-physics reveals, perpetual ticker, text scramble on scroll

The design language is: editorial agency, not startup SaaS. Strong blackletter weight in display type, structured by contrast rather than decoration.

---

## 2. Color Palette & Roles

- **Warm Cream** (#f4f2ed) — Primary background. Not white. Warm, tactile, like uncoated paper
- **Off-Black Ink** (#0a0a0a) — Primary text, button fills, borders. Never pure black
- **Muted Stone** (#6b6560) — Secondary text, labels, metadata, subdued captions
- **Surface Warm** (#e8e5df) — Card and container fills, ticker background, divider shims
- **Whisper Border** (rgba(10,10,10,0.1)) — Structural 1px lines, card edges, nav underlines
- **Electric Moss** (#b8ff00) — Single accent. CTAs, active states, accent dots, focus rings. Use sparingly — it earns its place
- **Banned:** Any purple, neon blue, gradient fills spanning multiple colors, oversaturated hues

---

## 3. Typography Rules

- **Display (Headlines):** Bricolage Grotesque — weight 800–900, letter-spacing -0.03em to -0.04em, scale via `clamp()`. Hierarchy through massive size contrast, not multiple weights
- **Body:** Satoshi or Cabinet Grotesk — NOT Inter (banned in premium contexts). Weight 400–500, leading 1.6, max 65ch per line
- **Labels / Metadata:** Inter Tight or Geist Mono — small caps or uppercase tracking for section labels, timestamps, counters
- **Scale:** Display clamp(52px, 17vw, 248px) → Section Titles clamp(32px, 6vw, 72px) → Body 16px/1.6 → Labels 12–13px uppercase
- **Banned:** Inter for body text in premium contexts. Generic serifs. Anything that screams "template"

---

## 4. Component Stylings

- **Primary Buttons:** Flat rectangle, Off-Black fill, Warm Cream text. On active: -1px translate (tactile push). On hover: slightly lighter (#2a2a2a). Zero border-radius or sharp 2px max. No outer glow. No gradients
- **Ghost Buttons:** 1px Off-Black border, transparent fill. Hover: fill with Off-Black, text flips to Cream
- **Cards (Work/Portfolio):** Sharp corners or 4px max radius. Surface Warm fill. 1px Whisper Border. Hover: lift via `translateY(-4px)` + shadow deepens. No rounded-xl. No drop shadows with color
- **Contact Form:** Labels above inputs, always. No floating labels. Focus ring in Electric Moss. Inputs: 1px border, no background fill, transparent. Error text below in muted red
- **Section Labels:** Uppercase, 12px, letter-spacing 0.12em, Stone Muted color — acts as wayfinding, never decorative
- **Ticker / Marquee:** Continuous scroll. Surface Warm strip. Off-Black text. No pause on hover
- **Loaders:** Skeletal shimmer matching layout shape. No spinners

---

## 5. Layout Principles

- **Hero:** Left-aligned, bottom-anchored headline. Full viewport height. Headline occupies most of viewport width. No centering
- **Grid:** CSS Grid primary. 12-column at desktop, 4-column at tablet, 1-column at mobile. No flexbox `calc()` hacks
- **Asymmetry:** Avoid 3-equal-column layouts. Use 1+2 splits, 2/3+1/3 splits, staggered masonry for portfolio
- **Max-width:** 1440px container, 48px side padding desktop, 24px mobile
- **Section spacing:** `clamp(80px, 12vw, 160px)` vertical gaps between sections
- **No overlapping elements:** Every element has its own clear spatial zone. Absolute positioning only for decorative, pointer-events: none elements
- **Mobile-first:** All multi-column collapses to single column below 768px. No horizontal scroll ever

---

## 6. Motion & Interaction

- **Spring physics:** `stiffness: 120, damping: 22` — weighted, premium feel. No linear easing. No ease-in-out on primary transitions
- **Page intro:** Logo slam-in then dissolve — sets the editorial tone immediately
- **Hero text:** Staggered word-by-word reveal, translateY from 40px + opacity 0 → 1
- **Scroll reveals:** Section titles scramble (character randomization → resolve). Section content stagger cascade 80ms delay per item
- **Custom cursor:** Dot + ring, mix-blend-mode: difference — only on desktop (hover: pointer devices)
- **Guide shape:** Blob morph following scroll position — purely decorative, opacity low
- **Micro-interactions:** Every card, button, nav link has a defined hover state. Nothing is static
- **Ticker:** `animation: scroll linear infinite` — never pauses
- **Banned:** Animating width/height/top/left. Janky scroll-jank on mobile. Motion on touch devices

---

## 7. Anti-Patterns (Banned)

- No Inter font for body in premium layout
- No pure black (#000000) anywhere
- No neon outer glows or colored box-shadows
- No centered hero layouts
- No 3 equal cards in a row
- No emoji anywhere
- No generic AI copy: "Elevate", "Seamless", "Next-Gen", "Unleash", "Transform your business"
- No filler UI: "Scroll to explore", chevron bounce animations, scroll indicators
- No fabricated metrics or fake statistics — if real numbers aren't provided, use clear placeholder labels
- No gradient text on large headlines
- No custom cursor on touch/mobile devices
- No overlapping stacked elements
- No broken image links — use picsum.photos or SVG placeholders
- No LABEL // YEAR formatting convention
- No fake system metrics dashboards
- No generic placeholder names ("Acme Corp", "John Doe")
- No oversaturated second accent colors — Electric Moss (#b8ff00) is the only accent, used with restraint
