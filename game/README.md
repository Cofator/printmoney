# Age of Empire Clone 🏛️⚔️

Um jogo de estratégia em tempo real (RTS) inspirado em **Age of Empires IV**, feito para rodar
**inteiramente no navegador**. Sem instalação, sem servidor no seu PC: é publicado gratuitamente
no **GitHub Pages** e o multiplayer usa **WebRTC peer-to-peer** (broker público do PeerJS).

## 🎮 Jogar agora

Depois que o GitHub Pages estiver ativo (veja abaixo), o jogo fica disponível em:

**https://cofator.github.io/printmoney/**

## ✨ Funcionalidades

- **Economia completa**: 4 recursos (comida 🍖, madeira 🪵, ouro 🪙, pedra 🪨), aldeões que
  coletam de florestas, minas, arbustos e ovelhas, depósitos e fazendas.
- **Construção**: Centro Urbano, Casa (população), Moinho, Serraria, Mineração, Quartel,
  Arqueria, Estábulo e Torre defensiva.
- **Unidades militares**: Aldeão, Lanceiro, Espadachim, Arqueiro, Besteiro, Batedor e Cavaleiro —
  com bônus de combate entre classes (tesoura-pedra-papel: infantaria/cavalaria/arqueiros).
- **3 Eras**: Feudal → Castelos → Imperial, desbloqueando unidades e edifícios avançados.
- **IA adversária** em 3 dificuldades (fácil / normal / difícil) que gerencia economia,
  avança de era e ataca.
- **Névoa de guerra**, minimapa, seleção por caixa, grupos de controle, pontos de encontro,
  pathfinding A*, projéteis e barras de vida.
- **Multiplayer 1v1 online** por código de sala (P2P, sem servidor dedicado).
- **Controles**: WASD/setas e bordas da tela para mover a câmera, roda do mouse para zoom,
  botão esquerdo seleciona, botão direito comanda.

## 🕹️ Como jogar

| Ação | Comando |
|------|---------|
| Selecionar unidade | Clique esquerdo / arrastar caixa |
| Selecionar todas do tipo | Duplo-clique |
| Mover / Atacar / Coletar | Clique direito no destino/inimigo/recurso |
| Construir | Selecione aldeão → botão do edifício → clique no mapa |
| Treinar | Selecione o edifício → botão da unidade |
| Grupos de controle | Ctrl+1..9 salva, 1..9 seleciona |
| Centralizar no Centro Urbano | H |
| Destruir seleção | Delete |

**Objetivo:** destrua o Centro Urbano do inimigo (e impeça-o de reconstruir).

## 🌐 Multiplayer

1. Um jogador clica em **Criar Sala Online** e recebe um código (ex.: `ABC123`).
2. O outro clica em **Entrar em Sala** e digita o código.
3. A partida inicia automaticamente quando ambos conectam.

O **host** roda a simulação autoritativa e envia snapshots; o **convidado** envia comandos e
renderiza. Toda a comunicação é P2P via WebRTC — nenhum servidor de jogo é hospedado por você.

## 🚀 Publicação (uma vez)

1. No GitHub, vá em **Settings → Pages**.
2. Em **Source**, selecione **GitHub Actions**.
3. O workflow [`deploy-game.yml`](../.github/workflows/deploy-game.yml) publica a pasta `game/`
   automaticamente a cada push.

## 🛠️ Rodar localmente

Como é 100% estático, basta um servidor de arquivos:

```bash
cd game
npx http-server -p 8080
# abra http://localhost:8080
```

## 🧱 Arquitetura

```
game/
├── index.html            # UI, HUD, menus
├── css/style.css
└── js/
    ├── main.js           # orquestração, loop de jogo, modos (1 jogador / host / convidado)
    ├── engine/           # camera, renderer (Canvas 2D), input, utils
    ├── game/             # simulation (autoritativa), world, pathfinding, config,
    │                     #   ai, hud, model (visão host/cliente)
    └── net/net.js        # multiplayer P2P via PeerJS
```

A simulação é determinística por tick (20 Hz) e independente da renderização, permitindo o
modelo host-autoritativo do multiplayer.
