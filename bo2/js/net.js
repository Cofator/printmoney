// Rede P2P via WebRTC (PeerJS + broker público gratuito). Topologia estrela: host retransmite.
const PREFIX = 'bows2-x7q-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

// Broker de sinalização: nuvem PeerJS por padrão; customizável via ?peerhost=...&peerport=...
function peerOpts() {
  const q = new URLSearchParams(location.search);
  const opts = { debug: 1 };
  if (q.get('peerhost')) {
    opts.host = q.get('peerhost');
    opts.port = Number(q.get('peerport') || 443);
    opts.path = q.get('peerpath') || '/';
    opts.secure = q.get('peersecure') !== '0';
  }
  return opts;
}

export class Net {
  constructor() {
    this.peer = null;
    this.conns = new Map();   // peerId -> DataConnection (host: todos; cliente: só host)
    this.isHost = false;
    this.hostConn = null;
    this.onMessage = null;    // (fromId, msg)
    this.onPeerJoin = null;   // (peerId)  [host]
    this.onPeerLeave = null;  // (peerId)
    this.onHostLost = null;   // ()        [cliente]
  }

  host(code, cb) {
    this.isHost = true;
    this.peer = new Peer(PREFIX + code, peerOpts());
    let done = false;
    this.peer.on('open', () => { if (!done) { done = true; cb(null); } });
    this.peer.on('error', (e) => {
      if (!done) { done = true; cb(e); }
    });
    this.peer.on('connection', (conn) => {
      conn.on('open', () => {
        this.conns.set(conn.peer, conn);
        this.onPeerJoin?.(conn.peer);
      });
      conn.on('data', (d) => this.onMessage?.(conn.peer, d));
      conn.on('close', () => {
        if (this.conns.delete(conn.peer)) this.onPeerLeave?.(conn.peer);
      });
      conn.on('error', () => {
        if (this.conns.delete(conn.peer)) this.onPeerLeave?.(conn.peer);
      });
    });
  }

  join(code, cb) {
    this.isHost = false;
    this.peer = new Peer(peerOpts());
    let done = false;
    this.peer.on('error', (e) => { if (!done) { done = true; cb(e); } });
    this.peer.on('open', () => {
      const conn = this.peer.connect(PREFIX + code, { reliable: true });
      const timeout = setTimeout(() => {
        if (!done) { done = true; cb(new Error('Sala não encontrada — confira o código.')); }
      }, 30000);
      conn.on('open', () => {
        clearTimeout(timeout);
        this.hostConn = conn;
        this.conns.set(conn.peer, conn);
        if (!done) { done = true; cb(null); }
      });
      conn.on('data', (d) => this.onMessage?.(conn.peer, d));
      conn.on('close', () => { if (done) this.onHostLost?.(); });
      conn.on('error', () => {
        clearTimeout(timeout);
        if (!done) { done = true; cb(new Error('Falha na conexão.')); }
      });
    });
  }

  get myId() { return this.peer?.id || 'local'; }

  // cliente → host
  send(obj) { try { this.hostConn?.send(obj); } catch (_) {} }

  // host → todos (exceto um, opcionalmente)
  broadcast(obj, exceptId = null) {
    for (const [id, c] of this.conns) {
      if (id === exceptId) continue;
      try { c.send(obj); } catch (_) {}
    }
  }

  sendTo(id, obj) { try { this.conns.get(id)?.send(obj); } catch (_) {} }

  close() {
    try { this.peer?.destroy(); } catch (_) {}
    this.peer = null;
    this.conns.clear();
    this.hostConn = null;
  }
}
