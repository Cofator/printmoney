# 🏙️ Micropolis 2000

A **SimCity 2000–style city builder** that runs entirely in the browser — no install,
no accounts, no dedicated server — with **online co-op multiplayer**.

**Play it here:** https://cofator.github.io/printmoney/simcity/

## Features

- **Isometric city view** with procedurally drawn graphics (zero external assets)
- **Zoning:** Residential / Commercial / Industrial zones that develop through 8
  density levels driven by a live RCI demand model
- **Power grid:** coal, gas, nuclear, wind and solar plants; power lines (they can
  cross roads); capacity vs. demand with brownouts
- **Water system:** pumps and towers whose coverage unlocks high-density growth
- **Transport:** roads and rail with autotiling and simulated traffic
- **City services:** police, fire, hospitals, schools, college, library — with
  radius coverage, funding sliders and real effects on crime, fires and land value
- **Simulation layers:** pollution, crime, land value, traffic, coverage overlays
  and a live minimap
- **Economy:** per-zone tax rates, department budgets, bonds, monthly cash flow
- **Disasters:** fires that spread, tornado, earthquake, meteor, monster — random
  or unleashed on purpose
- **History charts, news ticker, milestones, save/load** (3 local slots + file
  export/import)
- **Online co-op multiplayer:** host a room, share a link, build the same city
  with a shared treasury, chat and live player cursors

## Multiplayer — how it works (no server!)

Connections are **peer-to-peer WebRTC** (via [PeerJS](https://peerjs.com)). The free
public PeerJS broker is used only to introduce peers; all game traffic flows
directly between browsers.

- The **host's browser** runs the authoritative simulation.
- Everyone's build actions are validated by the host and echoed to all players.
- A full state snapshot is synced every few seconds to correct any drift.

To play: **🌐 Multiplayer → Create room**, then send the link (or 5-letter code)
to friends. Optional: self-host a broker and add `?peerserver=host:port/path`.

## Development

Plain HTML/CSS/JS — no build step:

```bash
cd simcity
python3 -m http.server 8000
# open http://localhost:8000
```

## Controls

| Action | Input |
|---|---|
| Pan | right/middle drag, arrow keys, minimap click |
| Zoom | mouse wheel, `+` / `-`, pinch |
| Build | pick a tool, click or drag on the map |
| Inspect tile | `Q`, then click |
| Bulldoze | `B` |
| Road / Power line / Trees | `R` / `P` / `T` |
| Zones R/C/I | `1` / `2` / `3` |
| Pause | Space |
