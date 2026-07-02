import { clamp } from './utils.js';
import { TILE } from '../game/config.js';

export class Camera {
  constructor(model) {
    this.model = model;
    this.x = 0; this.y = 0; this.zoom = 1;
    this.minZoom = 0.35; this.maxZoom = 2.2;
    this.vw = 0; this.vh = 0;
  }
  resize(w, h) { this.vw = w; this.vh = h; this.clampPos(); }
  worldW() { return this.model.W * TILE; }
  worldH() { return this.model.H * TILE; }
  clampPos() {
    const maxX = Math.max(0, this.worldW() - this.vw / this.zoom);
    const maxY = Math.max(0, this.worldH() - this.vh / this.zoom);
    this.x = clamp(this.x, 0, maxX);
    this.y = clamp(this.y, 0, maxY);
  }
  pan(dx, dy) { this.x += dx / this.zoom; this.y += dy / this.zoom; this.clampPos(); }
  centerOn(wx, wy) { this.x = wx - this.vw / this.zoom / 2; this.y = wy - this.vh / this.zoom / 2; this.clampPos(); }
  zoomAt(sx, sy, factor) {
    const wx = this.x + sx / this.zoom, wy = this.y + sy / this.zoom;
    this.zoom = clamp(this.zoom * factor, this.minZoom, this.maxZoom);
    this.x = wx - sx / this.zoom; this.y = wy - sy / this.zoom;
    this.clampPos();
  }
  toScreen(wx, wy) { return { x: (wx - this.x) * this.zoom, y: (wy - this.y) * this.zoom }; }
  toWorld(sx, sy) { return { x: this.x + sx / this.zoom, y: this.y + sy / this.zoom }; }
}
