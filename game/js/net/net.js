// Multiplayer P2P via PeerJS (broker público gratuito). O host é autoritativo:
// simula o jogo e envia snapshots; o cliente envia comandos e renderiza.
const PREFIX = 'aoe4clone-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Carrega a biblioteca PeerJS sob demanda (não bloqueia o jogo de 1 jogador).
let peerLoading = null;
const PEER_CDNS = [
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
];
export function ensurePeer() {
  if (typeof window.Peer !== 'undefined') return Promise.resolve();
  if (peerLoading) return peerLoading;
  peerLoading = new Promise((resolve, reject) => {
    let i = 0;
    const tryNext = () => {
      if (typeof window.Peer !== 'undefined') return resolve();
      if (i >= PEER_CDNS.length) return reject(new Error('Não foi possível carregar a biblioteca de rede (PeerJS). Verifique sua conexão.'));
      const s = document.createElement('script');
      s.src = PEER_CDNS[i++];
      s.onload = () => resolve();
      s.onerror = () => tryNext();
      document.head.appendChild(s);
    };
    tryNext();
  });
  return peerLoading;
}

function randomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export class NetHost {
  constructor() {
    this.peer = null; this.conn = null; this.code = null;
    this.onGuestJoin = null; this.onCommand = null; this.onGuestLeft = null;
    this.connected = false;
  }
  async start() {
    await ensurePeer();
    return new Promise((resolve, reject) => {
      this.code = randomCode();
      this.peer = new Peer(PREFIX + this.code, { debug: 1 });
      this.peer.on('open', () => resolve(this.code));
      this.peer.on('error', (err) => {
        // se id em uso, tenta outro código
        if (err.type === 'unavailable-id') { this.code = randomCode(); this.peer.reconnect?.(); }
        reject(err);
      });
      this.peer.on('connection', (conn) => {
        this.conn = conn;
        conn.on('open', () => { this.connected = true; this.onGuestJoin && this.onGuestJoin(); });
        conn.on('data', (msg) => {
          if (msg.type === 'cmd' && this.onCommand) this.onCommand(msg.cmd);
        });
        conn.on('close', () => { this.connected = false; this.onGuestLeft && this.onGuestLeft(); });
      });
    });
  }
  send(obj) { if (this.conn && this.conn.open) this.conn.send(obj); }
  sendSnapshot(snap) { this.send({ type: 'snap', s: snap }); }
  sendEvent(text, warn) { this.send({ type: 'event', text, warn }); }
  sendInit(payload) { this.send({ type: 'init', p: payload }); }
  destroy() { try { this.peer && this.peer.destroy(); } catch (e) {} }
}

export class NetGuest {
  constructor() {
    this.peer = null; this.conn = null;
    this.onInit = null; this.onSnapshot = null; this.onEvent = null; this.onClose = null;
  }
  async join(code) {
    await ensurePeer();
    return new Promise((resolve, reject) => {
      this.peer = new Peer({ debug: 1 });
      let done = false;
      this.peer.on('open', () => {
        this.conn = this.peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
        this.conn.on('open', () => { done = true; resolve(); });
        this.conn.on('data', (msg) => {
          if (msg.type === 'init' && this.onInit) this.onInit(msg.p);
          else if (msg.type === 'snap' && this.onSnapshot) this.onSnapshot(msg.s);
          else if (msg.type === 'event' && this.onEvent) this.onEvent(msg.text, msg.warn);
        });
        this.conn.on('close', () => this.onClose && this.onClose());
        setTimeout(() => { if (!done) reject(new Error('Tempo esgotado ao conectar. Verifique o código.')); }, 15000);
      });
      this.peer.on('error', (err) => { if (!done) reject(err); });
    });
  }
  send(obj) { if (this.conn && this.conn.open) this.conn.send(obj); }
  sendCommand(cmd) { this.send({ type: 'cmd', cmd }); }
  destroy() { try { this.peer && this.peer.destroy(); } catch (e) {} }
}
