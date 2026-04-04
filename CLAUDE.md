# Globale Anweisungen

## Ziel

Der Kunde soll die Website sehen und geflasht sein. Er soll das Gefühl haben: **"Das ist meins."** So gut, so persönlich, so genau auf ihn zugeschnitten — dass er gar nicht mehr nein sagen kann.

Qualitätsmaßstab: Nicht "gut genug". Nicht "solide". Sondern: würde dieser Kunde das stolz seinen Freunden zeigen?

## Arbeitsweise

Autonom arbeiten. Nicht nachfragen, nicht zögern. Research → Bauen → Review → Deployen. Am Ende Live-URL ausgeben.

---

## Workflow für neue Kunden-Website

**Schritt 1 — Research**
- Alte Website mit Firecrawl scrapen → nur Inhalte extrahieren: Leistungen, Adresse, Öffnungszeiten, Menü, Team
- Alte Website mit Playwright aufrufen und Screenshot machen → echte Fotos (Gerichte, Räume, Produkte, Team) identifizieren und URLs notieren
- Google Maps → Adresse, Öffnungszeiten, Bewertungen, Sterne
- Instagram/Social Media mit Playwright → echte Fotos, Stimmung, Zielgruppe
- Logo identifizieren und URL notieren
- NIEMALS Design, Farben, Fonts oder Layout von der alten Website übernehmen — diese sind oft schlecht
- Texte immer komplett neu schreiben: emotional, überzeugend, auf die Zielgruppe zugeschnitten

**Schritt 2 — Design System (komplett neu)**
- UI/UX Pro Max Skill für Stil-Empfehlung passend zu Branche + Zielgruppe
- Eigene Farbpalette — professionell, modern, emotional passend zur Branche
- Google Fonts — frisch auswählen, passend zum Stil
- Echte Fotos vom Unternehmen verwenden (aus Schritt 1)
- Unsplash nur wenn keine ausreichend guten echten Fotos vorhanden

**Schritt 3 — Bauen**
- Single-File HTML mit eingebettetem CSS + JS
- Motion CDN für Animationen — Scroll-Animationen, Hover-Effekte, Übergänge
- Mobile-first, kein horizontales Scrollen
- Hohe visuelle Qualität: klare Hierarchie, Whitespace, professionelle Typografie
- Echte Inhalte — keine Platzhalter wie "Lorem ipsum"
- **21st.dev MCP** für fertige UI-Komponenten nutzen:
  - `mcp__magic__21st_magic_component_builder` → Hero, Cards, Nav, Sections generieren
  - `mcp__magic__21st_magic_component_refiner` → Komponenten verfeinern und anpassen
  - `mcp__magic__21st_magic_component_inspiration` → Design-Inspiration holen
  - `mcp__magic__logo_search` → Kunden-Logo oder Branchen-Logos suchen

**Schritt 4 — Review**
- Playwright Screenshot (Desktop + 375px Mobile) machen und selbst prüfen
- Prüfen: Sieht es wirklich krass aus? Würde der Kunde nein sagen können?

**Schritt 5 — Deployen**
- Committen und pushen
- GitHub Pages aktivieren falls noch nicht aktiv:
  ```bash
  gh api repos/{owner}/{repo}/pages --method POST --field source='{"branch":"main","path":"/"}' 2>/dev/null || true
  ```
- Live-URL ausgeben: `https://{owner}.github.io/{repo}/clients/{kundenname}/`

---

## Motion / Animationen

Jede neue HTML-Datei bekommt Motion via CDN eingebunden (direkt vor `</head>`):

```html
<script src="https://cdn.jsdelivr.net/npm/motion@latest/dist/motion.js"></script>
```

Animationen mit `Motion.animate()` oder `Motion.scroll()` umsetzen — kein npm, kein Build-Schritt.

---

## HTML-Projekte (Single-File)

- Kein Framework, kein Build-System, kein npm
- Alles in einer einzigen `.html`-Datei (CSS + JS eingebettet)
- Motion via CDN ist die Standard-Animationslibrary
- Nach jeder Änderung: committen und pushen

---

## Ordnerstruktur & URLs

Jeder Kunde bekommt einen eigenen Ordner:
```
clients/<kundenname>/index.html
```

Live-URL bei GitHub Pages:
```
https://sempergo.github.io/cloude-test/clients/<kundenname>/
```
