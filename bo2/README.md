# BLACK OPS WEB II 🎮

FPS multiplayer que roda 100% no navegador, inspirado em Call of Duty: Black Ops 2.
Sem instalação, sem servidor próprio — o multiplayer usa WebRTC peer-to-peer
(o navegador de quem cria a sala atua como anfitrião).

## ▶ Como jogar

**Online (endereço público):** após o deploy do GitHub Pages, o jogo fica em
`https://<usuario>.github.io/<repo>/` (ex.: `https://cofator.github.io/printmoney/`).

**Local:** `cd bo2 && python3 -m http.server 8080` e abra `http://localhost:8080`.

## 🌐 Multiplayer em rede

1. Um jogador clica em **CRIAR PARTIDA ONLINE** — recebe um código de 5 letras e um link.
2. Os amigos abrem o link (ou digitam o código em **ENTRAR**).
3. Bots preenchem as vagas e cedem lugar quando humanos entram.

A sinalização usa o broker público gratuito do PeerJS (`0.peerjs.com`); o tráfego
do jogo flui direto entre os navegadores via WebRTC. Ninguém precisa instalar nada.

## ✨ Funcionalidades

- **Modo Mata-Mata em Equipe** (limite de 75 pontos / 10 min) + treinamento contra bots
- **4 classes**: Assalto (M8A1), Velocista (PDW-57), Atirador (DSR 50), Demolidor (R-870 MCS) — todas com Five-Seven de reserva
- **Scorestreaks**: UAV (300), Míssil Hellstorm (500), Cães de Guerra (700)
- Mira ADS (com luneta no sniper), sprint, agachar, pular, recarga, faca, granadas com física
- Tiro na cabeça com dano extra, regeneração de vida, hitmarkers, killfeed, minimapa com UAV
- Placar (Tab), cronômetro, telas de morte/vitória, bots com IA (patrulha, perseguição, rajadas)
- Sons 100% procedurais via WebAudio (sem assets externos)

## 🎮 Controles

| Tecla | Ação | Tecla | Ação |
|---|---|---|---|
| WASD | mover | Botão dir. | mira (ADS) |
| Mouse | mirar | R | recarregar |
| Botão esq. | atirar | G | granada |
| Shift | correr | V | faca |
| Espaço | pular | 1 / 2 | trocar arma |
| C | agachar | 3 / 4 / 5 | scorestreaks |
| Tab | placar | Esc | pausa |

## 🔧 Broker alternativo

Se o broker público estiver indisponível, aponte para outro servidor PeerJS:
`index.html?peerhost=meu.servidor.com&peerport=443&peerpath=/`

## Aviso

Projeto de fã, sem afiliação com Activision. Nenhum asset do jogo original é usado —
todo o conteúdo (mapa, modelos, sons) é gerado proceduralmente.
