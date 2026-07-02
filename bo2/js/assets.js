// Carregamento de modelos 3D (glTF). O soldado é o modelo animado dos
// exemplos oficiais do three.js (esqueleto + animações Idle/Walk/Run).
import { GLTFLoader } from '../vendor/loaders/GLTFLoader.js';

export const ASSETS = { soldier: null };

export function preloadAssets() {
  new GLTFLoader().loadAsync('./assets/soldier.glb')
    .then(g => { ASSETS.soldier = g; })
    .catch(e => console.warn('Falha ao carregar modelo do soldado (usando fallback):', e));
}
