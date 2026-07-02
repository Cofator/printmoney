import { Simulation } from './game/simulation.js';
import { HostModel, ClientModel } from './game/model.js';
import { AI } from './game/ai.js';
import { Camera } from './engine/camera.js';
import { Renderer } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { HUD } from './game/hud.js';
import { NetHost, NetGuest } from './net/net.js';
import { TICK_RATE, TICK_MS, SNAPSHOT_EVERY, AGES } from './game/config.js';

const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), tutorial: $('tutorial'), game: $('game') };
function show(name) { for (const k in screens) screens[k].classList.toggle('hidden', k !== name); }

let session = null;

// ==================== Sessão de Jogo ====================
class GameSession {
  constructor(config) {
    this.config = config;               // {mode, mapSize, seed, aiDifficulty, localPlayerId, net}
    this.mode = config.mode;            // 'single' | 'host' | 'guest'
    this.localPlayerId = config.localPlayerId;
    this.running = false;
    this.pending = [];                  // comandos aguardando próximo tick (host/single)
    this.acc = 0; this.lastT = 0;
    this.ais = [];
    this.net = config.net || null;
  }

  async start() {
    // recria o canvas (evita conflito de contexto 2D/WebGL entre sessões)
    const oldCanvas = $('canvas');
    const canvas = oldCanvas.cloneNode(false);
    oldCanvas.replaceWith(canvas);
    if (this.mode === 'guest') {
      this.model = new ClientModel(this.config.mapSize, this.config.numPlayers, this.config.seed, this.localPlayerId);
    } else {
      const aiPlayers = this.mode === 'single' ? [1] : [];
      this.sim = new Simulation({
        mapSize: this.config.mapSize, numPlayers: this.config.numPlayers,
        seed: this.config.seed, aiPlayers,
      });
      this.model = new HostModel(this.sim, this.localPlayerId);
      if (this.mode === 'single') this.ais.push(new AI(1, this.config.aiDifficulty));
    }

    // renderização 3D (WebGL) com fallback 2D automático
    try {
      const three = await import('./engine/renderer3d.js');
      this.camera = new three.Camera3D(this.model);
      this.renderer = new three.Renderer3D(canvas, this.model, this.camera);
    } catch (err) {
      console.warn('3D indisponível; usando renderização 2D.', err);
      this.camera = new Camera(this.model);
      this.renderer = new Renderer(canvas, this.model, this.camera);
    }
    this.dispatch = (cmd) => this.onDispatch(cmd);
    this.hud = new HUD({ model: this.model, camera: this.camera, renderer: this.renderer,
      input: null, dispatch: this.dispatch, localPlayerId: this.localPlayerId });
    this.input = new Input({ canvas, camera: this.camera, model: this.model, renderer: this.renderer,
      hud: this.hud, dispatch: this.dispatch, localPlayerId: this.localPlayerId });
    this.hud.input = this.input;

    this.resize();
    window.addEventListener('resize', this._resize = () => this.resize());

    // centraliza no próprio Centro Urbano
    setTimeout(() => this.input.centerOnTC(), 50);
    this.hud.refreshSelection();
    // dica inicial de controles
    setTimeout(() => this.hud.toast('💡 Clique nos aldeões, depois botão DIREITO em árvores/ouro para coletar. WASD move a câmera.'), 700);
    setTimeout(() => this.hud.toast('🏠 Selecione um aldeão e use o painel inferior para construir.'), 4200);

    // rede: host envia init e escuta comandos do convidado
    if (this.mode === 'host' && this.net) {
      this.net.sendInit({ mapSize: this.config.mapSize, numPlayers: this.config.numPlayers, seed: this.config.seed });
      this.net.onCommand = (cmd) => { cmd.owner = 1; this.pending.push(cmd); };
      this.net.onGuestLeft = () => { this.hud.toast('Adversário desconectou.', true); };
      this.netStatus('Conectado ao adversário');
    }
    if (this.mode === 'guest' && this.net) {
      this.net.onSnapshot = (snap) => this.model.applySnapshot(snap, performance.now());
      this.net.onEvent = (text, warn) => this.hud.toast(text, warn);
      this.net.onClose = () => { this.hud.toast('Conexão com o host perdida.', true); };
      this.netStatus('Conectado ao host');
    }

    this.running = true;
    this.lastT = performance.now();
    window.__game = this;   // acesso para depuração/testes
    requestAnimationFrame((t) => this.loop(t));
    show('game');
  }

  netStatus(text) {
    const el = $('net-status');
    if (this.mode === 'single') { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = '🌐 ' + text;
  }

  onDispatch(cmd) {
    if (this.mode === 'guest') { this.net.sendCommand(cmd); }
    else { this.pending.push(cmd); }
  }

  resize() {
    const canvas = $('canvas');
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    this.camera.resize(w, h);
  }

  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;

    this.input.updateCamera(dt);

    if (this.mode !== 'guest') {
      this.acc += dt * 1000;
      let steps = 0;
      while (this.acc >= TICK_MS && steps < 5) {
        this.acc -= TICK_MS; steps++;
        for (const ai of this.ais) ai.update(this.sim);
        const cmds = this.pending; this.pending = [];
        this.sim.step(cmds);
        this.processEvents();
        if (this.mode === 'host' && this.sim.tick % SNAPSHOT_EVERY === 0)
          this.net.sendSnapshot(this.sim.snapshot(this.sim.tick % 20 === 0));
      }
    }

    this.renderer.render(now);
    this.hud.update(now);
    this.checkGameOver();
    requestAnimationFrame((t) => this.loop(t));
  }

  processEvents() {
    if (!this.sim || !this.sim.events.length) return;
    for (const ev of this.sim.events) {
      if (ev.playerId === this.localPlayerId) this.hud.toast(ev.text, ev.warn);
      else if (this.mode === 'host' && this.net) this.net.sendEvent(ev.text, ev.warn);
    }
    this.sim.events.length = 0;
  }

  checkGameOver() {
    if (this.endShown) return;
    if (this.model.gameOver) {
      this.endShown = true;
      const won = this.model.winner === this.localPlayerId;
      this.showEndgame(won);
    } else if (this.mode !== 'guest' && this.sim && this.sim.players[this.localPlayerId]?.defeated) {
      // derrota mesmo com jogo em andamento (multi > 2 improvável aqui)
      this.endShown = true; this.showEndgame(false);
    }
  }

  showEndgame(won) {
    const ov = $('endgame');
    $('endgame-title').textContent = won ? 'Vitória!' : 'Derrota';
    $('endgame-title').className = won ? '' : 'defeat';
    const s = this.sim ? this.sim.players[this.localPlayerId].stats : null;
    $('endgame-sub').textContent = won
      ? 'Você dominou o mapa!' + (s ? ` Unidades treinadas: ${s.trained} • Abates: ${s.kills}` : '')
      : 'Sua civilização foi derrotada. Tente novamente!';
    ov.classList.remove('hidden');
  }

  stop() {
    this.running = false;
    window.removeEventListener('resize', this._resize);
    if (this.renderer && this.renderer.dispose) this.renderer.dispose();
    if (this.net) this.net.destroy();
    $('net-status').classList.add('hidden');
    $('endgame').classList.add('hidden');
  }
}

// ==================== Fluxo de Menu ====================
function randSeed() { return (Math.random() * 2 ** 31) | 0; }

function startSingle() {
  const diff = $('ai-difficulty').value;
  const size = parseInt($('map-size').value, 10);
  session = new GameSession({ mode: 'single', mapSize: size, numPlayers: 2,
    seed: randSeed(), aiDifficulty: diff, localPlayerId: 0 });
  session.start();
}

async function startHost() {
  const lobby = $('lobby'), lh = $('lobby-host');
  lobby.classList.remove('hidden'); lh.classList.remove('hidden');
  $('lobby-join').classList.add('hidden');
  $('room-code').textContent = '…';
  $('host-status').textContent = 'Criando sala…';
  const net = new NetHost();
  const size = parseInt($('map-size').value, 10);
  const seed = randSeed();
  try {
    const code = await net.start();
    $('room-code').textContent = code;
    $('host-status').textContent = 'Aguardando adversário conectar…';
    net.onGuestJoin = () => {
      $('host-status').textContent = 'Adversário conectado! Iniciando…';
      session = new GameSession({ mode: 'host', mapSize: size, numPlayers: 2,
        seed, localPlayerId: 0, net });
      setTimeout(() => session.start(), 400);
    };
  } catch (err) {
    $('host-status').textContent = 'Erro ao criar sala: ' + (err.message || err.type || err);
  }
}

function startJoinUI() {
  const lobby = $('lobby');
  lobby.classList.remove('hidden');
  $('lobby-join').classList.remove('hidden');
  $('lobby-host').classList.add('hidden');
  $('join-status').textContent = '';
  $('join-code').focus();
}

async function doJoin() {
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length < 4) { $('join-status').textContent = 'Código inválido.'; return; }
  $('join-status').textContent = 'Conectando…';
  const net = new NetGuest();
  net.onInit = (p) => {
    session = new GameSession({ mode: 'guest', mapSize: p.mapSize, numPlayers: p.numPlayers,
      seed: p.seed, localPlayerId: 1, net });
    session.start();
  };
  try {
    await net.join(code);
    $('join-status').textContent = 'Conectado! Aguardando início do host…';
  } catch (err) {
    $('join-status').textContent = 'Falha: ' + (err.message || err.type || 'não foi possível conectar');
  }
}

function backToMenu() {
  if (session) { session.stop(); session = null; }
  $('lobby').classList.add('hidden');
  $('lobby-host').classList.add('hidden');
  $('lobby-join').classList.add('hidden');
  show('menu');
}

// ==================== Wiring ====================
$('btn-single').onclick = startSingle;
$('btn-host').onclick = startHost;
$('btn-join').onclick = startJoinUI;
$('btn-do-join').onclick = doJoin;
$('btn-back').onclick = () => { if (session) session.stop(); session = null; $('lobby').classList.add('hidden'); };
$('btn-tutorial').onclick = () => show('tutorial');
$('btn-tut-back').onclick = () => show('menu');
$('btn-menu').onclick = backToMenu;
$('btn-endgame').onclick = backToMenu;
$('btn-copy').onclick = () => {
  const code = $('room-code').textContent;
  navigator.clipboard?.writeText(code);
  $('btn-copy').textContent = 'Copiado!';
  setTimeout(() => $('btn-copy').textContent = 'Copiar código', 1500);
};
$('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

// sinaliza que o menu inicializou (o watchdog no index.html usa isto)
window.__menuReady = true;
console.log('Age of Empire Clone — pronto. Boa sorte, comandante!');
