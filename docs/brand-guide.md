# Washudiwa — Brand Guide

## Name & Pronunciation

**Washudiwa** — pronounce it however you like. The chuckle comes when you realize it can be read as *"what should I watch?"* said fast. The name is a phonetic contraction of the question every movie lover dreads answering.

The Easter egg should be a **discovery**, not a billboard. The logo never spells it out.

---

## Logo System

The identity is built around the **Venn-eye** — two overlapping circles whose intersection forms a watching eye. It encodes the product's core mechanic: *what you should watch emerges from where two people's taste overlaps*.

### The Mark (Venn-eye)

Two thin-stroked circles overlapping to form a vesica piscis. The intersection is filled with the brand green, and a dark pupil sits at center — turning the geometric overlap into an eye.

**Usage:**
- Nav bars and headers (`<LogoMark className="h-6" />`)
- Favicon and app icon (`src/app/icon.svg`)
- Social avatars, small placements
- Loading states (the circles can animate together, the eye can blink)

**Files:**
- React component: `<LogoMark />` from `@/components/logo`
- Static SVG: `public/logo-mark.svg`
- Favicon: `src/app/icon.svg` (auto-detected by Next.js)

### The Wordmark

The full word "washudiwa" in a light-weight sans-serif with generous tracking. The dot of the "i" is replaced by a miniature Venn-eye mark — a typographic Easter egg that rewards close inspection.

**Usage:**
- Landing page hero (`<Logo className="text-5xl" />`)
- Marketing materials, large display contexts
- Best at `text-2xl` and above — the Venn-eye detail needs room to breathe

**File:**
- React component: `<Logo />` from `@/components/logo`

### Logo Sizing

| Context           | Component     | Class          |
|-------------------|---------------|----------------|
| Nav / header      | `<LogoMark>`  | `h-6`          |
| Sign-in / auth    | `<LogoMark>`  | `h-10`         |
| Hero / splash     | `<Logo>`      | `text-5xl`     |
| Marketing large   | `<Logo>`      | `text-6xl`     |

### Don'ts

- Don't use the wordmark at small sizes — the Venn-eye detail gets lost below `text-xl`
- Don't add drop shadows, glows, or gradients to the mark
- Don't recolor the green intersection — it's always `--primary`
- Don't animate the pupil in a creepy way

---

## Voice & Messaging

### Core Value Prop

> Quickly answer the dreaded question of 'what should I watch?'

### How It Works (3 steps)

1. Link your Letterboxd
2. Find your taste twins
3. Find movies you'll love that you haven't watched yet

### Tone

- Confident, not corporate
- Cinephile-to-cinephile — assumes the reader watches movies seriously
- Slightly irreverent ("the dreaded question")
- No jargon about algorithms — talk about taste, not tech

---

## Visual Identity

### Theme

Dark mode by default. The aesthetic is **Letterboxd meets Linear** — minimal, editorial, data-rich.

### Colors

| Token              | Value (dark)              | Usage                          |
|--------------------|---------------------------|--------------------------------|
| `--primary`        | `oklch(0.78 0.18 145)`    | Green accent — CTAs, logo eye, data highlights |
| `--background`     | `oklch(0.13 0.005 260)`   | Page background, logo pupil    |
| `--card`           | `oklch(0.17 0.005 260)`   | Card surfaces                  |
| `--muted-foreground` | `oklch(0.6 0 0)`        | Secondary text                 |
| `--destructive`    | `oklch(0.65 0.2 25)`      | Errors, strong disagrees       |

### Typography

| Role   | Font            | Usage                              |
|--------|-----------------|-------------------------------------|
| Sans   | Inter           | Body text, headings, wordmark       |
| Mono   | JetBrains Mono  | Stats, data labels, CTAs, buttons   |

- Monospace for anything quantitative or branded (ratings, scores, step numbers, buttons)
- Sans-serif for everything else
- The wordmark uses Inter font-light with wide tracking

### Cards & Surfaces

- Subtle borders (`border-border/50`), not heavy outlines
- Hover states with smooth transitions
- Tactile feel — slight depth through border contrast, not drop shadows

---

## Animation Ideas

The Venn-eye mark lends itself to motion:

- **Loading:** Two circles slide together from the sides, green intersection fades in, pupil appears
- **Blink:** The intersection briefly closes (circles separate slightly) then reopens
- **Scan:** The pupil moves subtly, as if watching/searching
- **Match found:** The green pulses once

---

## Don'ts

- Don't use a light theme as the default
- Don't describe the algorithm to users — frame everything as "taste twins" and "movies you'll love"
- Don't use generic AI/tech language ("powered by," "algorithm," "machine learning")
- Don't affiliate with or imply endorsement by Letterboxd

---

*This guide should evolve as the product and brand mature. Update it when making design decisions that establish new patterns.*
