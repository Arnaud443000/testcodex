# Pulse — Prompts de maquettes (ChatGPT / génération d'images)

Objectif : générer plusieurs **directions visuelles** du même écran, comparer, en choisir une, puis me renvoyer les images pour que je mette à jour `docs/charte-graphique.md` (tokens, composants) avant de coder l'interface.

Les prompts sont en **anglais** (meilleur rendu des images). Les libellés d'interface sont volontairement en anglais dans les maquettes : le texte généré par image est fiable surtout en anglais, on traduira à l'implémentation.

---

## Mode d'emploi

1. Ouvrir une **nouvelle conversation ChatGPT** (génération d'images) par style, pour éviter les mélanges.
2. Coller le **bloc « Contexte commun »**, puis le **prompt du style** (section 2), dans le même message.
3. Pour chaque style, demander d'abord l'**écran Dashboard**. Si le style plaît, générer les 3 écrans de la section 3 dans la même conversation (cohérence).
4. Si le résultat est bon mais imparfait, itérer avec des retouches courtes (section 4) plutôt que de tout réécrire.
5. Me renvoyer les 1 à 2 images retenues (et la conversation si utile). Je m'occupe d'en tirer les tokens exacts (couleurs, rayons, ombres, échelle typographique).

Astuce : joindre le logo Pulse existant à la conversation et écrire « use this logo exactly » pour qu'il soit repris tel quel.

---

## 1. Contexte commun (à coller avant chaque style)

```
Design a high-fidelity UI mockup of a Windows desktop application called "Pulse":
a personal trading journal used by a discretionary trader to log trades, review
their process (emotions, discipline, rule adherence) and track performance.
Show a single full app window at 16:9, 1920x1080, flat front view (no device
frame, no perspective, no 3D tilt), crisp and pixel-aligned like a real product
screenshot, not an illustration.
Brand tagline (small, optional): "Clarity. Discipline. Performance."
The core idea of the product: process matters as much as result, so the UI must
show discipline and execution quality next to profit and loss.
Data must look realistic: a trader with about 180 trades, net P&L +12,480 USD,
win rate 58%, profit factor 1.74, max drawdown -6.2%, average risk/reward 1.9.
Use tabular (monospaced) numerals for all figures, explicit + / - signs on P&L.
Never use color alone to signal gain or loss: also add a text label or sign.
No stock photos, no people, no fake third-party brand logos.
```

---

## 2. Directions de style — Dashboard

### Style A — « Pulse actuel » (référence, à comparer aux autres)
Continuité avec la charte v1.2 : nuit bleutée, accent bleu-violet, boutons pilule.

```
Style: deep midnight blue-black app (#0B0E27 background, cards #171B33),
primary accent is a blue-to-violet gradient (#4A5FD9 to #8B7FE8) used only for
navigation active state, primary buttons and the equity curve. Cream (#F0EDE4)
secondary buttons. Gains in sage green (#5FCB9E), losses in coral (#F0776B).
Fully rounded pill buttons with subtle glossy inner highlight, cards with 20px
rounded corners and soft diffuse shadow, hairline borders at 8% white.
Typeface: SF Pro Display / Inter, clean and light.
Layout: fixed left sidebar (248px) with icon+label nav (Dashboard, Trades,
Calendar, Analytics, Behavior, Journal, Goals, Settings) and Pulse logo on top;
top bar with account selector chip and period selector (1D 1W 1M 3M 1Y ALL) and
a "New trade" primary pill button. Content on a 12-column grid: hero card with
Net P&L (large number) and a gradient area equity curve (8 cols) next to an
"Insights" panel (4 cols); a row of 5 KPI cards with tiny sparklines (Win rate,
Profit factor, Avg trade, Risk/Reward, Max drawdown); below: sessions arc gauge,
hourly performance bar chart, strategy donut, mini month calendar heatmap, and a
recent-trades table with Long/Short colored text.
Add a "Discipline score" circular gauge 82/100 as a card.
```

### Style B — « Minimal clair » (Swiss / data-first)
```
Style: light, warm and calm, Swiss editorial minimalism. Warm off-white
background (#F7F4EE), white cards with no borders and only very soft shadows,
ink text (#12162A). Almost no color: deep indigo (#3B49B8) is the only accent,
used sparingly for the active nav item, the primary button and the equity line.
Gains in muted green (#2F8F68), losses in muted red (#C64435), always with sign.
Lots of white space, strict grid, thin 1px rules between sections, small
uppercase tracking labels, large light-weight numerals for KPIs.
Typeface: Inter, light and regular weights, no bold headlines.
Layout: slim left navigation (icons + labels), hero net P&L with a thin line
chart, KPI row, discipline score as a simple ring, month P&L heatmap calendar,
performance by setup as horizontal bars, recent trades table with hairline rows.
Feels like a printed financial report or a Stripe/Linear-quality interface.
```

### Style C — « Terminal pro » (dense, type Bloomberg)
```
Style: professional trading terminal, high information density, near-black
background (#08090C), panels separated by 1px dark grey lines, no rounded
corners (2px max). Monospace typeface (JetBrains Mono / IBM Plex Mono) for all
data, condensed uppercase labels. Amber (#FFB000) as the single UI accent for
headers and focus; gains bright green (#3DDC97), losses red (#FF5C5C), always
with +/- signs. Multi-panel layout in a tight grid: net P&L and equity curve
with drawdown underlay, statistics table (win rate, expectancy in R, profit
factor, Sharpe, max drawdown), R-multiple distribution histogram, P&L by hour
heatmap, streak tracker, active alerts panel, recent trades blotter with many
columns (asset, side, size, entry, exit, R, P&L, setup, plan followed Y/N).
Keyboard-shortcut hints in the corners. Feels fast, serious, and uncluttered
despite the density.
```

### Style D — « Glass & aurora » (moderne, lumineux)
```
Style: modern dark UI with frosted-glass panels over a soft aurora gradient
background (deep navy with blurred violet, blue and teal light blobs).
Translucent cards (backdrop blur, 1px white 10% border, 24px radius), glowing
gradient accents (electric blue to violet to magenta), subtle neon glow on the
equity curve and on active elements. Gains in mint (#5CF2B0), losses in soft
coral (#FF7A7A) with sign and label. Big rounded pill buttons, floating
icon-only sidebar with tooltips, smooth and premium, similar to a fintech
mobile-first brand scaled up to desktop.
Cards: net P&L hero with glowing curve, discipline score ring with gradient
stroke, sessions donut, win/loss donut, calendar heatmap, insights list with
small icons, recent trades table on a glass panel.
Keep it readable: strong contrast on all text, glow used only on 2-3 elements.
```

### Style E — « Carnet de bord » (éditorial, chaleureux — pensé pour un *journal*)
```
Style: a trading journal that feels like a beautiful notebook, not a casino.
Dark warm charcoal background (#16140F) with paper-like cream text (#EFE9DC),
soft bronze/amber accent (#C9A35A) and deep teal (#3E8C86) as secondary.
Gains in olive-sage green (#8DB48E), losses in terracotta (#C9694F), always with
signs. Headlines in an elegant serif (e.g. Fraunces / Newsreader), body and
numbers in a clean sans (Inter) with tabular figures. Generous spacing, subtle
paper grain texture at 3% only on the background, 12px radius cards with thin
warm borders, understated buttons (solid bronze pill for primary).
Layout: left sidebar with journal-style sections (Today, Trades, Calendar,
Review, Rules, Goals); main area emphasizes the DAILY JOURNAL: today's entry with
mood, reflection questions ("What went well?", "What to improve?"), rule
checklist ticked or not, followed by today's trades as cards with emotion tags
and star ratings, plus a compact performance strip (P&L, win rate, discipline
score) at the top. Calm, reflective, premium.
```

---

## 3. Autres écrans (à générer dans la conversation du style retenu)

À coller **après** avoir choisi un style, dans la même conversation :

### 3.1 Formulaire de saisie de trade
```
Same app, same style, same window size. Screen: "New trade" form as a right-side
drawer or centered wide modal over the dimmed dashboard. Sections with clear
headers: 1 Basics (asset, Long/Short segmented control, date/time, session,
timeframe), 2 Price & size (entry, exit, size, stop loss, take profit, fees) with
a live P&L and R-multiple preview chip, 3 Context (setup tag, market condition
chips: Range / Trend / High volatility / News), 4 The "why" (entry thesis
textarea, conviction slider 1-10, emotion before/during/after chips, "Plan
followed" toggle), 5 Rules & checklist (pre-trade checklist with checkboxes,
personal rules ticked/unticked), 6 After the trade (execution quality 1-5, star
rating, post-mortem textarea, screenshot drop zone). Footer with a "Save
trade" primary pill and "Quick add" secondary. A warning banner "No stop loss
set" in amber.
```

### 3.2 Détail d'un trade / replay
```
Same app, same style. Screen: trade detail view. Left: chart screenshot large
with entry / stop / target annotations. Right: summary card with asset, side,
size, entry/exit, net P&L (+ sign), R-multiple, duration, badges "Gain" and
"Plan followed", execution quality 4/5, stars. Below: entry thesis, emotion
timeline (before -> during -> after) as three chips, rules respected/broken
list, post-mortem text, and an AI "Screenshot review" comment card (optional
feature, marked "AI"). Prev/next trade arrows and filter by star rating at the top.
```

### 3.3 Analyse comportementale
```
Same app, same style. Screen: "Behavior". Big circular discipline score 78/100
with its weighted components listed. Horizontal bars of P&L and win rate per
emotion (FOMO, Discipline, Revenge, Calm, Stress). Streak tracker with current
and longest win/loss streaks. Comparison "In plan vs Out of plan" (two columns:
avg P&L, win rate). "First trade of the day vs next trades" comparison. A
"Recurring mistakes" ranked list with counts and cumulative P&L lost per
mistake (Early exit, Overtrading, Poor risk management, No plan, Revenge trade).
Active alert banner at the top: "3 losing trades in a row today — overtrading risk".
```

---

## 4. Retouches courtes utiles

- « Make the text more legible: increase contrast and font size by 10%. »
- « Reduce visual noise: remove decorative gradients except on the primary button and the equity line. »
- « Increase information density by 20%, keep the same style. »
- « Show the same screen in light theme with the same tokens. »
- « Keep everything, but align all cards to a strict 12-column grid with 24px gutters. »
- « Replace all invented labels with these exact labels: … »

---

## 5. Ce que je fais avec les images

Une fois le style choisi, je mets à jour `docs/charte-graphique.md` (version 2.0) : couleurs et tokens mesurés sur l'image, rayons, ombres, échelle typographique, composants, thème clair/sombre, et adaptation Windows (police de repli Inter, pas de SF Pro sur Windows). Ensuite seulement, on code l'interface (étape 1 du cahier des charges).
