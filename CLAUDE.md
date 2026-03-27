# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Git & GitHub

After every meaningful change, commit with a clean message and push to GitHub:

```bash
git add <files>
git commit -m "short summary

Optional longer description."
git push
```

Remote: https://github.com/sempergo/cloude-test (branch: `main`)

## Project Structure

This is a collection of standalone web projects — each is a single self-contained HTML file with embedded CSS and JavaScript. No build step, no dependencies, no package manager.

To run any file, open it directly in a browser:

```bash
open tictactoe.html
```

## Architecture

Each HTML file follows the same pattern:
- **HTML** — minimal semantic structure
- **CSS** — embedded in `<style>`, dark theme (`#1a1a2e` background palette)
- **JS** — embedded in `<script>`, no frameworks or external libraries

New projects should follow this same single-file, zero-dependency pattern unless there is a strong reason to deviate.
