/* ============================================================
 * Micropolis 2000 — render3d.js
 * High-quality 3D WebGL renderer built on three.js.
 *
 * - PBR materials with procedural textures (brick, glass curtain
 *   walls, concrete, corrugated metal, shingles)
 * - Physical sky with a day/night cycle: the sun travels, windows
 *   and street lights come on at night, PMREM environment光
 * - Animated water surface with a generated normal map
 * - Post-processing: UnrealBloom + FXAA
 * - Instanced everything: buildings, trees (with wind sway),
 *   cars, street lights, smoke, fire
 *
 * World mapping: tile (x, y) -> 3D (x, up, z=y), 1 tile = 1 unit.
 * ============================================================ */
'use strict';

const R3D = {
  active: false,
  ready: false,
  renderer: null, scene: null, camera: null, composer: null,
  // orbit state (des* are smoothed toward by the camera each frame)
  target: { x: W / 2, z: H / 2 },
  dist: 42, azim: -Math.PI / 4, elev: 0.72,
  _cur: null, // smoothed camera state
  // day/night cycle
  cycleOn: true, dayT: 0.42, CYCLE_SECONDS: 300,
  // scene objects
  ground: null, groundTex: null, groundCv: null,
  pools: new Map(),  // `${kind}:${mat}` -> InstancedMesh
  counts: new Map(),
  treeInst: {},
  carMesh: null, carTop: null, smokePts: null, fireInst: null, ghostInst: null,
  wireLines: null, cursorGroup: null, disasterGroup: null, waterMesh: null,
  sun: null, moon: null, hemi: null, sky: null, pmrem: null, envRT: null,
  fireLight: null,
  worldKey: '', groundKey: '', lastBuild: 0,
  MAX: { prim: 60000, tree: 30000, car: 600, smoke: 500, fire: 512, ghost: 2048 },
  _windUniform: { value: 0 },
};

const GROUND_PX = 16; // texture pixels per tile

/* ---------------- materials ---------------- */
const MAT_DEFS = {
  plain: () => new THREE.MeshLambertMaterial({ color: 0xffffff }),
  brick: () => new THREE.MeshStandardMaterial({ map: texBrick(), roughness: 0.92, metalness: 0.0 }),
  apart: () => new THREE.MeshStandardMaterial({
    map: texApartments(), roughness: 0.85, metalness: 0.02,
    emissiveMap: texApartmentsEmissive(), emissive: new THREE.Color(0xffc46a), emissiveIntensity: 0,
  }),
  glass: () => new THREE.MeshStandardMaterial({
    map: texGlass(), roughness: 0.22, metalness: 0.55, envMapIntensity: 1.3,
    emissiveMap: texGlassEmissive(), emissive: new THREE.Color(0xffd58a), emissiveIntensity: 0,
  }),
  conc: () => new THREE.MeshStandardMaterial({ map: texConcrete(), roughness: 0.95, metalness: 0.0 }),
  metal: () => new THREE.MeshStandardMaterial({ map: texMetal(), roughness: 0.5, metalness: 0.4 }),
  shingle: () => new THREE.MeshStandardMaterial({ map: texShingle(), roughness: 0.9, metalness: 0.0 }),
  glow: () => new THREE.MeshBasicMaterial({ color: 0x6b675c }), // brightened at night -> bloom
};
const POOL_CAP = { 'box:plain': 60000, 'pyr:plain': 8000, 'cyl:plain': 10000, 'sph:plain': 4000 };
const GEOS = {};

function poolFor(kind, mat) {
  const key = kind + ':' + mat;
  let mesh = R3D.pools.get(key);
  if (!mesh) {
    const cap = POOL_CAP[key] || 8000;
    const m = new THREE.InstancedMesh(GEOS[kind], MAT_DEFS[mat](), cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.receiveShadow = true;
    m.count = 0; m.frustumCulled = false;
    R3D.scene.add(m);
    R3D.pools.set(key, m);
    mesh = m;
  }
  return mesh;
}

/* ---------------- init ---------------- */
function init3D() {
  if (R3D.ready) return;
  const cv = document.getElementById('game3d');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  R3D.renderer = renderer;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x9cc4e4, 110, 320);
  R3D.scene = scene;

  R3D.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 4500);
  R3D._cur = { x: W / 2, z: H / 2, dist: R3D.dist, azim: R3D.azim, elev: R3D.elev };

  // physical sky + sun/moon lights
  const sky = new THREE.Sky();
  sky.scale.setScalar(2000);
  const su = sky.material.uniforms;
  su.turbidity.value = 6;
  su.rayleigh.value = 1.6;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.8;
  scene.add(sky);
  R3D.sky = sky;
  R3D.pmrem = new THREE.PMREMGenerator(renderer);

  R3D.hemi = new THREE.HemisphereLight(0xcfe5ff, 0x5d7a4a, 0.4);
  scene.add(R3D.hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 0.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 320;
  sun.shadow.bias = -0.00035;
  scene.add(sun); scene.add(sun.target);
  R3D.sun = sun;
  const moon = new THREE.DirectionalLight(0x8fa8d8, 0.0);
  scene.add(moon); scene.add(moon.target);
  R3D.moon = moon;
  R3D.fireLight = new THREE.PointLight(0xff8c30, 0, 14, 2);
  scene.add(R3D.fireLight);

  // ground plane with painted texture
  const gcv = document.createElement('canvas');
  gcv.width = W * GROUND_PX; gcv.height = H * GROUND_PX;
  R3D.groundCv = gcv;
  const tex = new THREE.CanvasTexture(gcv);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.encoding = THREE.sRGBEncoding;
  R3D.groundTex = tex;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(W, H),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, 0, H / 2);
  ground.receiveShadow = true;
  scene.add(ground);
  R3D.ground = ground;

  // earth skirt below the map + a dark sea filling the horizon so the
  // void under the sky dome never shows past the map edge
  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(W, 4, H),
    new THREE.MeshStandardMaterial({ color: 0x4a3d2e, roughness: 1 }));
  skirt.position.set(W / 2, -2.03, H / 2);
  scene.add(skirt);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ color: 0x16354f, roughness: 0.4, metalness: 0.1 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(W / 2, -3.9, H / 2);
  scene.add(sea);

  // shared geometries
  GEOS.box = new THREE.BoxGeometry(1, 1, 1);
  GEOS.pyr = new THREE.ConeGeometry(0.71, 1, 4);
  GEOS.cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
  GEOS.sph = new THREE.SphereGeometry(0.5, 14, 10);

  // tree pools with wind sway injected into the shaders
  const windify = (mat) => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = R3D._windUniform;
      shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float swayPh = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 2.3;
          transformed.x += sin(uWind * 2.1 + swayPh) * 0.09 * max(transformed.y, 0.0);
          transformed.z += cos(uWind * 1.7 + swayPh) * 0.06 * max(transformed.y, 0.0);
        #endif`);
    };
    return mat;
  };
  const mkTreePool = (geo, cap, mat) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.castShadow = true; m.receiveShadow = true;
    m.count = 0; m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  R3D.treeInst.trunk = mkTreePool(new THREE.CylinderGeometry(0.05, 0.07, 1, 6), R3D.MAX.tree,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }));
  R3D.treeInst.cone = mkTreePool(new THREE.ConeGeometry(0.32, 1, 8), R3D.MAX.tree,
    windify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })));
  R3D.treeInst.ball = mkTreePool(new THREE.SphereGeometry(0.34, 9, 7), R3D.MAX.tree,
    windify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })));

  // cars: body + cabin
  const mkDyn = (geo, cap, mat) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.receiveShadow = true;
    m.count = 0; m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  R3D.carMesh = mkDyn(new THREE.BoxGeometry(0.34, 0.11, 0.17), R3D.MAX.car,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.55 }));
  R3D.carTop = mkDyn(new THREE.BoxGeometry(0.17, 0.08, 0.15), R3D.MAX.car,
    new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.2, metalness: 0.4 }));
  R3D.carTop.castShadow = false;

  // fire cones (emissive -> bloom)
  R3D.fireInst = mkDyn(new THREE.ConeGeometry(0.34, 1, 6), R3D.MAX.fire,
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92 }));
  R3D.fireInst.castShadow = false;

  // ghost highlight tiles
  const gh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x7dff8c, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }),
    R3D.MAX.ghost);
  gh.count = 0; gh.frustumCulled = false;
  scene.add(gh);
  R3D.ghostInst = gh;

  // smoke particles (soft round sprite)
  const scv = document.createElement('canvas');
  scv.width = scv.height = 64;
  const sctx = scv.getContext('2d');
  const sg = sctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  sg.addColorStop(0, 'rgba(255,255,255,0.9)');
  sg.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  sctx.fillStyle = sg;
  sctx.fillRect(0, 0, 64, 64);
  const smokeTex = new THREE.CanvasTexture(scv);
  const sgeo = new THREE.BufferGeometry();
  sgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(R3D.MAX.smoke * 3), 3));
  R3D.smokePts = new THREE.Points(sgeo,
    new THREE.PointsMaterial({ color: 0xcfd4d8, size: 0.8, map: smokeTex, transparent: true, opacity: 0.42, sizeAttenuation: true, depthWrite: false }));
  R3D.smokePts.frustumCulled = false;
  scene.add(R3D.smokePts);

  R3D.cursorGroup = new THREE.Group(); scene.add(R3D.cursorGroup);
  R3D.disasterGroup = new THREE.Group(); scene.add(R3D.disasterGroup);

  // post-processing: bloom + FXAA
  const composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, R3D.camera));
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.55, 0.74);
  composer.addPass(bloom);
  const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
  composer.addPass(fxaa);
  R3D.composer = composer;
  R3D._bloom = bloom; R3D._fxaa = fxaa;

  updateDayNight(0, true);
  R3D.ready = true;
}

/* ---------------- day / night cycle ---------------- */
const _sunVec = { v: null };
function updateDayNight(dtMs, force) {
  if (!_sunVec.v) _sunVec.v = new THREE.Vector3();
  if (R3D.cycleOn) {
    R3D.dayT = (R3D.dayT + (dtMs / 1000) / R3D.CYCLE_SECONDS) % 1;
  }
  const t = R3D.dayT;
  // sun elevation: -1 (midnight) .. +1 (noon)
  const elevSin = Math.sin((t - 0.25) * Math.PI * 2);
  const day = clamp(elevSin * 2.6, 0, 1);          // daylight factor
  const dusk = clamp(1 - Math.abs(elevSin) * 4, 0, 1); // sunrise/sunset factor
  const night = 1 - day;

  // visual sun position on the sky dome
  const sunEl = Math.max(elevSin, -0.14) * Math.PI / 2.4;
  const sunAz = (t - 0.25) * Math.PI * 2 * 0.9 - Math.PI / 3;
  _sunVec.v.setFromSphericalCoords(1, Math.PI / 2 - sunEl, sunAz);
  R3D.sky.material.uniforms.sunPosition.value.copy(_sunVec.v);
  R3D.sky.material.uniforms.turbidity.value = 6 + dusk * 8;
  R3D.sky.material.uniforms.rayleigh.value = 1.6 + dusk * 2.2;

  // sun light (kept slightly above horizon so shadows stay sane)
  const tgt = R3D.target;
  const lel = Math.max(sunEl, 0.14);
  R3D.sun.position.set(
    tgt.x + Math.cos(sunAz) * Math.cos(lel) * 60,
    Math.sin(lel) * 70 + 6,
    tgt.z + Math.sin(sunAz) * Math.cos(lel) * 60);
  R3D.sun.target.position.set(tgt.x, 0, tgt.z);
  R3D.sun.intensity = 0.12 + day * 1.15;
  R3D.sun.color.setHSL(0.085 + 0.04 * day, 0.5 + dusk * 0.4, 0.62 + day * 0.28);

  R3D.moon.position.set(tgt.x - 40, 50, tgt.z + 30);
  R3D.moon.target.position.set(tgt.x, 0, tgt.z);
  R3D.moon.intensity = night * 0.34;

  R3D.hemi.intensity = 0.17 + day * 0.33;
  R3D.renderer.toneMappingExposure = 0.6 - night * 0.14;

  // fog color follows the sky
  const fc = R3D.scene.fog.color;
  fc.setRGB(
    lerp(0.045, lerp(0.61, 0.95, dusk * 0.4), day) ,
    lerp(0.06, lerp(0.77, 0.72, dusk * 0.5), day),
    lerp(0.11, lerp(0.89, 0.62, dusk * 0.6), day));

  // windows & street lights come on in the evening
  const glowOn = clamp(night * 1.6 - 0.1, 0, 1);
  for (const key of ['box:apart', 'box:glass']) {
    const p = R3D.pools.get(key);
    if (p) p.material.emissiveIntensity = glowOn * 1.7;
  }
  const lampPool = R3D.pools.get('box:glow');
  if (lampPool) lampPool.material.color.setRGB(0.42 + glowOn * 1.7, 0.40 + glowOn * 1.45, 0.36 + glowOn * 0.9);
  if (R3D.fireInst) {
    // fire is a touch brighter at night so the bloom pops
    R3D.fireInst.material.opacity = 0.85 + glowOn * 0.1;
  }

  // refresh the PMREM environment occasionally (expensive)
  const now = performance.now();
  if (force || !R3D._lastEnv || (R3D.cycleOn && now - R3D._lastEnv > 4000)) {
    R3D._lastEnv = now;
    if (R3D.envRT) R3D.envRT.dispose();
    R3D.envRT = R3D.pmrem.fromScene(R3D.sky);
    R3D.scene.environment = R3D.envRT.texture;
  }
}

/* ---------------- camera ---------------- */
function cam3DApply(dtMs) {
  const t = R3D.target;
  t.x = clamp(t.x, 0, W); t.z = clamp(t.z, 0, H);
  R3D.dist = clamp(R3D.dist, 6, 150);
  R3D.elev = clamp(R3D.elev, 0.22, 1.4);
  // critically-damped-ish smoothing for a fluid camera feel
  const k = 1 - Math.pow(0.0012, (dtMs || 16) / 1000);
  const c = R3D._cur;
  c.x += (t.x - c.x) * k; c.z += (t.z - c.z) * k;
  c.dist += (R3D.dist - c.dist) * k;
  c.azim += (R3D.azim - c.azim) * k;
  c.elev += (R3D.elev - c.elev) * k;
  const cam = R3D.camera;
  const cy = Math.sin(c.elev) * c.dist;
  const ch = Math.cos(c.elev) * c.dist;
  cam.position.set(c.x + Math.cos(c.azim) * ch, cy, c.z + Math.sin(c.azim) * ch);
  cam.lookAt(c.x, 0, c.z);
  // keep the shadow window tight around the view
  const s = R3D.sun;
  const ext = Math.max(26, c.dist * 0.95);
  s.shadow.camera.left = -ext; s.shadow.camera.right = ext;
  s.shadow.camera.top = ext; s.shadow.camera.bottom = -ext;
  s.shadow.camera.updateProjectionMatrix();
}

function r3dPan(dxPx, dyPx) {
  const cv = R3D.renderer.domElement;
  const k = R3D.dist * 1.35 / cv.clientHeight;
  const fx = Math.cos(R3D.azim), fz = Math.sin(R3D.azim);
  const rx = -fz, rz = fx;
  R3D.target.x += (-dxPx * rx + dyPx * fx) * k;
  R3D.target.z += (-dxPx * rz + dyPx * fz) * k;
}
function r3dZoom(factor) { R3D.dist /= factor; }
function r3dRotate(dAz, dEl) { R3D.azim += dAz; R3D.elev += dEl || 0; }

const _ray = { caster: null, ndc: null, plane: null, pt: null };
function r3dPick(cssX, cssY) { // CSS px within canvas -> [wx, wy] tile coords
  if (!_ray.caster) {
    _ray.caster = new THREE.Raycaster();
    _ray.ndc = new THREE.Vector2();
    _ray.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    _ray.pt = new THREE.Vector3();
  }
  const cv = R3D.renderer.domElement;
  _ray.ndc.set((cssX / cv.clientWidth) * 2 - 1, -(cssY / cv.clientHeight) * 2 + 1);
  _ray.caster.setFromCamera(_ray.ndc, R3D.camera);
  const hit = _ray.caster.ray.intersectPlane(_ray.plane, _ray.pt);
  if (!hit) return [-1, -1];
  return [hit.x, hit.z];
}

/* ---------------- ground texture ---------------- */
const GROUND_COLS = {
  grassA: '#5f9444', grassB: '#557f3c', sand: '#c4b480', water: '#173f6b',
  road: '#3e4044', walk: '#94918a', rail: '#6f675a',
  lotR: '#7c6b4c', lotC: '#87898c', lotI: '#867f6d', rubble: '#5d5a52',
};

function paintGroundCanvas(S, overlay) {
  const ctx = R3D.groundCv.getContext('2d');
  const P = GROUND_PX;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = S.type[i];
      let col;
      const terr = S.terr[i];
      if (terr === T_WATER) col = GROUND_COLS.water;
      else if (terr === T_SAND) col = GROUND_COLS.sand;
      else if (terr === T_RUBBLE) col = GROUND_COLS.rubble;
      else col = hash2(x, y, S.seed) < 0.5 ? GROUND_COLS.grassA : GROUND_COLS.grassB;
      if (t === B_RES || t === B_COM || t === B_IND) col = t === B_RES ? GROUND_COLS.lotR : (t === B_COM ? GROUND_COLS.lotC : GROUND_COLS.lotI);
      else if (t !== B_NONE && t !== B_ROAD && t !== B_RAIL && t !== B_WIRE) col = '#9aa1a8';
      ctx.fillStyle = col;
      ctx.fillRect(x * P, y * P, P, P);
      if (t === B_NONE && terr !== T_WATER && terr !== T_SAND) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        if (hash2(x, y, 7) < 0.3) ctx.fillRect(x * P + (hash2(x, y, 9) * P) | 0, y * P + (hash2(y, x, 11) * P) | 0, 2, 2);
      }
    }
  }
  // roads / rails as connected strips
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const t = S.type[i];
      if (t !== B_ROAD && t !== B_RAIL) continue;
      const cx = x * P + P / 2, cy = y * P + P / 2;
      const conn = (j) => S.type[j] === B_ROAD || S.type[j] === B_RAIL;
      const dirs = [];
      if (y > 0 && conn(i - W)) dirs.push([0, -1]);
      if (x < W - 1 && conn(i + 1)) dirs.push([1, 0]);
      if (y < H - 1 && conn(i + W)) dirs.push([0, 1]);
      if (x > 0 && conn(i - 1)) dirs.push([-1, 0]);
      if (!dirs.length) dirs.push([0, -1], [0, 1]);
      if (t === B_ROAD) {
        ctx.fillStyle = GROUND_COLS.walk;
        ctx.fillRect(x * P, y * P, P, P);
        ctx.strokeStyle = GROUND_COLS.road;
        ctx.lineWidth = P * 0.62; ctx.lineCap = 'round';
        for (const [dx, dy] of dirs) {
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.lineTo(cx + dx * P / 2, cy + dy * P / 2); ctx.stroke();
        }
        if (dirs.length <= 2) {
          ctx.strokeStyle = '#e8d878'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
          for (const [dx, dy] of dirs) {
            ctx.beginPath(); ctx.moveTo(cx, cy);
            ctx.lineTo(cx + dx * P / 2, cy + dy * P / 2); ctx.stroke();
          }
          ctx.setLineDash([]);
        }
      } else {
        ctx.strokeStyle = GROUND_COLS.rail; ctx.lineWidth = P * 0.5; ctx.lineCap = 'round';
        for (const [dx, dy] of dirs) {
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.lineTo(cx + dx * P / 2, cy + dy * P / 2); ctx.stroke();
        }
        ctx.strokeStyle = '#9aa0a8'; ctx.lineWidth = 1;
        for (const [dx, dy] of dirs) {
          for (const off of [-2.5, 2.5]) {
            ctx.beginPath();
            ctx.moveTo(cx + dy * off, cy + dx * off);
            ctx.lineTo(cx + dx * P / 2 + dy * off, cy + dy * P / 2 + dx * off);
            ctx.stroke();
          }
        }
      }
    }
  }
  if (overlay) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const col = overlayColor(overlay, S, y * W + x);
        if (col) { ctx.fillStyle = col; ctx.fillRect(x * P, y * P, P, P); }
      }
    }
  }
  R3D.groundTex.needsUpdate = true;
}

/* ---------------- animated water surface ---------------- */
function rebuildWater(S) {
  if (R3D.waterMesh) {
    R3D.scene.remove(R3D.waterMesh);
    R3D.waterMesh.geometry.dispose();
  }
  const verts = [], idxs = [], uvs = [];
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (S.terr[y * W + x] !== T_WATER) continue;
      verts.push(x, 0.05, y, x + 1, 0.05, y, x + 1, 0.05, y + 1, x, 0.05, y + 1);
      uvs.push(x / 8, y / 8, (x + 1) / 8, y / 8, (x + 1) / 8, (y + 1) / 8, x / 8, (y + 1) / 8);
      idxs.push(n, n + 2, n + 1, n, n + 3, n + 2);
      n += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idxs);
  g.computeVertexNormals();
  if (!R3D._waterMat) {
    const nm = texWaterNormal();
    R3D._waterMat = new THREE.MeshStandardMaterial({
      color: 0x2a6db5, transparent: true, opacity: 0.78,
      roughness: 0.12, metalness: 0.05,
      normalMap: nm, normalScale: new THREE.Vector2(0.55, 0.55),
      envMapIntensity: 1.1,
    });
  }
  R3D.waterMesh = new THREE.Mesh(g, R3D._waterMat);
  R3D.waterMesh.receiveShadow = true;
  R3D.scene.add(R3D.waterMesh);
}

/* ---------------- building composer ---------------- */
// prims: {k, x, z, y, sx, sy, sz, c, mat?, rot?, tilt?, lie?, spin?}
const C3 = (r, g, b) => (r << 16) | (g << 8) | b;
const WALLS3 = [C3(188, 154, 112), C3(201, 178, 140), C3(172, 134, 100), C3(162, 162, 168), C3(190, 160, 128)];
const ROOFS3 = [C3(200, 120, 105), C3(170, 150, 130), C3(150, 160, 175), C3(195, 155, 110), C3(180, 115, 100)];
const BRICK_TINTS = [C3(255, 255, 255), C3(235, 215, 200), C3(255, 235, 215), C3(215, 225, 235), C3(240, 240, 240)];

function zonePrims(t, lvl, variant, cx, cz, out) {
  const wall = WALLS3[variant % 5], rc = ROOFS3[(variant + lvl) % 5];
  const U = (h) => h / 16;
  if (t === B_RES) {
    if (lvl <= 2) {
      out.push({ k: 'box', x: cx, z: cz, y: U(11) / 2, sx: 0.5, sy: U(11), sz: 0.5, c: wall });
      out.push({ k: 'pyr', x: cx, z: cz, y: U(11) + U(10) / 2, sx: 0.62, sy: U(10), sz: 0.62, c: rc, mat: 'shingle', rot: Math.PI / 4 });
    } else if (lvl <= 4) {
      out.push({ k: 'box', x: cx - 0.18, z: cz, y: U(15) / 2, sx: 0.42, sy: U(15), sz: 0.66, c: wall });
      out.push({ k: 'pyr', x: cx - 0.18, z: cz, y: U(15) + U(9) / 2, sx: 0.56, sy: U(9), sz: 0.56, c: rc, mat: 'shingle', rot: Math.PI / 4 });
      out.push({ k: 'box', x: cx + 0.26, z: cz + 0.1, y: U(11) / 2, sx: 0.32, sy: U(11), sz: 0.44, c: WALLS3[(variant + 2) % 5] });
      out.push({ k: 'pyr', x: cx + 0.26, z: cz + 0.1, y: U(11) + U(7) / 2, sx: 0.42, sy: U(7), sz: 0.42, c: ROOFS3[(variant + 3) % 5], mat: 'shingle', rot: Math.PI / 4 });
    } else if (lvl <= 6) {
      const h = U(30 + lvl * 3);
      out.push({ k: 'box', x: cx, z: cz, y: h / 2, sx: 0.76, sy: h, sz: 0.76, c: BRICK_TINTS[variant % 5], mat: 'brick' });
      out.push({ k: 'box', x: cx, z: cz, y: h + U(1.2) / 2, sx: 0.8, sy: U(1.2), sz: 0.8, c: C3(110, 78, 60) });
      out.push({ k: 'box', x: cx - 0.15, z: cz - 0.15, y: h + U(4) / 2, sx: 0.2, sy: U(4), sz: 0.2, c: C3(168, 172, 178) });
      out.push({ k: 'box', x: cx + 0.18, z: cz + 0.12, y: h + U(3.5) / 2, sx: 0.15, sy: U(3.5), sz: 0.15, c: C3(148, 152, 158) });
    } else {
      const h = U(54 + lvl * 4 + (variant % 3) * 6);
      out.push({ k: 'box', x: cx, z: cz, y: h / 2, sx: 0.7, sy: h, sz: 0.7, c: BRICK_TINTS[(variant + 1) % 5], mat: 'apart' });
      out.push({ k: 'box', x: cx, z: cz, y: h + U(1) / 2, sx: 0.74, sy: U(1), sz: 0.74, c: C3(120, 118, 126) });
      out.push({ k: 'box', x: cx, z: cz, y: h + U(6) / 2, sx: 0.26, sy: U(6), sz: 0.26, c: C3(140, 138, 146) });
    }
  } else if (t === B_COM) {
    const SIGNS = [C3(214, 69, 69), C3(63, 158, 99), C3(214, 143, 46), C3(122, 95, 208), C3(63, 142, 208)];
    if (lvl <= 2) {
      out.push({ k: 'box', x: cx, z: cz, y: U(13) / 2, sx: 0.7, sy: U(13), sz: 0.65, c: C3(198, 186, 164) });
      out.push({ k: 'box', x: cx, z: cz, y: U(13) + U(3) / 2, sx: 0.72, sy: U(3), sz: 0.67, c: SIGNS[variant % 5] });
    } else if (lvl <= 4) {
      out.push({ k: 'box', x: cx, z: cz, y: U(22) / 2, sx: 0.8, sy: U(22), sz: 0.75, c: C3(255, 255, 255), mat: 'conc' });
      out.push({ k: 'box', x: cx, z: cz, y: U(22) + U(4) / 2, sx: 0.82, sy: U(4), sz: 0.3, c: SIGNS[variant % 5] });
    } else if (lvl <= 6) {
      const h = U(42 + lvl * 4);
      out.push({ k: 'box', x: cx, z: cz, y: h / 2, sx: 0.76, sy: h, sz: 0.76, c: C3(255, 255, 255), mat: 'glass' });
      out.push({ k: 'box', x: cx, z: cz, y: h + U(1) / 2, sx: 0.8, sy: U(1), sz: 0.8, c: C3(70, 90, 110) });
      out.push({ k: 'box', x: cx - 0.12, z: cz - 0.12, y: h + U(4) / 2, sx: 0.24, sy: U(4), sz: 0.24, c: C3(96, 118, 140) });
    } else {
      const h = U(68 + lvl * 5 + (variant % 3) * 8);
      const tint = [C3(255, 255, 255), C3(220, 240, 255), C3(255, 245, 225)][variant % 3];
      out.push({ k: 'box', x: cx, z: cz, y: h / 2, sx: 0.64, sy: h, sz: 0.64, c: tint, mat: 'glass' });
      out.push({ k: 'box', x: cx, z: cz, y: h + U(1) / 2, sx: 0.68, sy: U(1), sz: 0.68, c: C3(45, 65, 85) });
      out.push({ k: 'box', x: cx, z: cz, y: h + U(8) / 2, sx: 0.26, sy: U(8), sz: 0.26, c: C3(52, 104, 148) });
      out.push({ k: 'cyl', x: cx, z: cz, y: h + U(8) + U(7) / 2, sx: 0.03, sy: U(7), sz: 0.03, c: C3(200, 60, 60) });
    }
  } else { // industrial
    if (lvl <= 2) {
      out.push({ k: 'box', x: cx, z: cz, y: U(13) / 2, sx: 0.8, sy: U(13), sz: 0.62, c: C3(255, 255, 255), mat: 'metal' });
      out.push({ k: 'pyr', x: cx, z: cz, y: U(13) + U(5) / 2, sx: 0.85, sy: U(5), sz: 0.85, c: C3(120, 124, 130), rot: Math.PI / 4 });
    } else if (lvl <= 5) {
      out.push({ k: 'box', x: cx - 0.1, z: cz, y: U(17) / 2, sx: 0.62, sy: U(17), sz: 0.62, c: C3(235, 235, 235), mat: 'metal' });
      out.push({ k: 'cyl', x: cx + 0.33, z: cz - 0.08, y: U(36) / 2, sx: 0.14, sy: U(36), sz: 0.14, c: C3(96, 88, 84) });
      out.push({ k: 'cyl', x: cx + 0.33, z: cz - 0.08, y: U(36) + U(1), sx: 0.15, sy: U(2), sz: 0.15, c: C3(200, 68, 58) });
    } else {
      out.push({ k: 'box', x: cx, z: cz, y: U(21) / 2, sx: 0.9, sy: U(21), sz: 0.8, c: C3(255, 255, 255), mat: 'metal' });
      out.push({ k: 'box', x: cx - 0.2, z: cz - 0.18, y: U(21) + U(12) / 2, sx: 0.35, sy: U(12), sz: 0.35, c: C3(102, 96, 90) });
      out.push({ k: 'cyl', x: cx + 0.23, z: cz - 0.19, y: U(54) / 2, sx: 0.12, sy: U(54), sz: 0.12, c: C3(88, 82, 78) });
      out.push({ k: 'cyl', x: cx + 0.39, z: cz - 0.19, y: U(54) / 2, sx: 0.12, sy: U(54), sz: 0.12, c: C3(88, 82, 78) });
      out.push({ k: 'cyl', x: cx - 0.25, z: cz + 0.22, y: U(21) + U(8) / 2, sx: 0.22, sy: U(8), sz: 0.22, c: C3(154, 162, 172) });
    }
  }
}

function civicPrims(t, ax, az, out) {
  const b = BLD[t], n = b.size;
  const cx = ax + n / 2, cz = az + n / 2;
  const U = (h) => h / 16;
  switch (t) {
    case B_COAL:
      out.push({ k: 'box', x: ax + 1.1, z: az + 1.5, y: U(27) / 2, sx: 1.8, sy: U(27), sz: 2.4, c: C3(120, 116, 118), mat: 'metal' });
      out.push({ k: 'box', x: ax + 2.45, z: az + 1.65, y: U(19) / 2, sx: 0.7, sy: U(19), sz: 1.5, c: C3(96, 92, 94), mat: 'metal' });
      out.push({ k: 'cyl', x: ax + 0.64, z: az + 0.675, y: U(76) / 2, sx: 0.28, sy: U(76), sz: 0.28, c: C3(66, 62, 64) });
      out.push({ k: 'cyl', x: ax + 1.24, z: az + 0.675, y: U(76) / 2, sx: 0.28, sy: U(76), sz: 0.28, c: C3(66, 62, 64) });
      out.push({ k: 'cyl', x: ax + 0.64, z: az + 0.675, y: U(76), sx: 0.3, sy: U(3), sz: 0.3, c: C3(200, 68, 58) });
      out.push({ k: 'cyl', x: ax + 1.24, z: az + 0.675, y: U(76), sx: 0.3, sy: U(3), sz: 0.3, c: C3(200, 68, 58) });
      out.push({ k: 'sph', x: ax + 2.45, z: az + 2.7, y: U(4), sx: 1.1, sy: 0.55, sz: 1.1, c: C3(38, 36, 42) });
      break;
    case B_GAS:
      out.push({ k: 'box', x: ax + 0.85, z: az + 1.0, y: U(21) / 2, sx: 1.3, sy: U(21), sz: 1.4, c: C3(130, 138, 146), mat: 'metal' });
      out.push({ k: 'box', x: ax + 0.55, z: az + 0.65, y: U(21) + U(26) / 2, sx: 0.3, sy: U(26), sz: 0.3, c: C3(96, 102, 110) });
      out.push({ k: 'sph', x: ax + 1.35, z: az + 1.35, y: U(14), sx: 1.1, sy: 1.1, sz: 1.1, c: C3(80, 150, 200) });
      break;
    case B_NUKE:
      out.push({ k: 'box', x: ax + 0.9, z: az + 1.4, y: U(23) / 2, sx: 1.4, sy: U(23), sz: 2.4, c: C3(255, 255, 255), mat: 'conc' });
      out.push({ k: 'sph', x: ax + 0.9, z: az + 1.4, y: U(23), sx: 1.3, sy: 1.0, sz: 1.3, c: C3(214, 218, 224) });
      out.push({ k: 'cyl', x: ax + 2.15, z: az + 0.8, y: U(53) / 2, sx: 0.85, sy: U(53), sz: 0.85, c: C3(255, 255, 255), mat: 'conc' });
      out.push({ k: 'cyl', x: ax + 2.15, z: az + 2.0, y: U(53) / 2, sx: 0.85, sy: U(53), sz: 0.85, c: C3(255, 255, 255), mat: 'conc' });
      break;
    case B_WIND:
      out.push({ k: 'cyl', x: cx, z: cz, y: U(44) / 2, sx: 0.08, sy: U(44), sz: 0.08, c: C3(232, 236, 240) });
      out.push({ k: 'box', x: cx, z: cz, y: U(44), sx: 0.75, sy: 0.06, sz: 0.06, c: C3(240, 244, 248), rot: 0.6, spin: true });
      break;
    case B_SOLAR:
      for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 3; c2++) {
        out.push({ k: 'box', x: ax + 0.42 + c2 * 0.55, z: az + 0.42 + r * 0.55, y: U(6), sx: 0.48, sy: 0.04, sz: 0.48, c: C3(29, 58, 107), mat: 'glass', tilt: 0.35 });
      }
      break;
    case B_POLICE:
      out.push({ k: 'box', x: cx, z: cz, y: U(23) / 2, sx: 1.6, sy: U(23), sz: 1.6, c: C3(150, 175, 220), mat: 'conc' });
      out.push({ k: 'box', x: cx, z: cz, y: U(23) + U(6) / 2, sx: 0.6, sy: U(6), sz: 0.6, c: C3(64, 90, 142) });
      break;
    case B_FIRE:
      out.push({ k: 'box', x: cx, z: cz, y: U(21) / 2, sx: 1.6, sy: U(21), sz: 1.6, c: C3(230, 120, 105), mat: 'brick' });
      out.push({ k: 'box', x: cx - 0.42, z: cz - 0.42, y: U(21) + U(21) / 2, sx: 0.55, sy: U(21), sz: 0.55, c: C3(156, 52, 44) });
      break;
    case B_HOSP:
      out.push({ k: 'box', x: cx, z: cz, y: U(31) / 2, sx: 1.7, sy: U(31), sz: 1.7, c: C3(255, 255, 255), mat: 'conc' });
      out.push({ k: 'box', x: cx, z: cz, y: U(31) + U(1.5) / 2, sx: 1.0, sy: U(1.5), sz: 1.0, c: C3(88, 94, 100) });
      out.push({ k: 'box', x: cx, z: cz, y: U(34), sx: 0.5, sy: 0.02, sz: 0.1, c: C3(211, 51, 51) });
      out.push({ k: 'box', x: cx, z: cz, y: U(34), sx: 0.1, sy: 0.02, sz: 0.5, c: C3(211, 51, 51) });
      break;
    case B_SCHOOL:
      out.push({ k: 'box', x: cx, z: cz, y: U(17) / 2, sx: 1.6, sy: U(17), sz: 1.4, c: C3(255, 230, 200), mat: 'brick' });
      out.push({ k: 'pyr', x: cx, z: cz, y: U(17) + U(12) / 2, sx: 1.65, sy: U(12), sz: 1.65, c: C3(190, 110, 90), mat: 'shingle', rot: Math.PI / 4 });
      break;
    case B_COLLEGE:
      out.push({ k: 'box', x: cx, z: cz, y: U(19) / 2, sx: 2.6, sy: U(19), sz: 2.6, c: C3(255, 250, 235), mat: 'conc' });
      out.push({ k: 'box', x: cx, z: cz, y: U(19) + U(17) / 2, sx: 1.0, sy: U(17), sz: 1.0, c: C3(230, 220, 195), mat: 'brick' });
      out.push({ k: 'pyr', x: cx, z: cz, y: U(36) + U(12) / 2, sx: 1.1, sy: U(12), sz: 1.1, c: C3(110, 150, 105), mat: 'shingle', rot: Math.PI / 4 });
      break;
    case B_LIBRARY:
      out.push({ k: 'box', x: cx, z: cz, y: U(19) / 2, sx: 1.6, sy: U(19), sz: 1.5, c: C3(255, 245, 225), mat: 'conc' });
      out.push({ k: 'pyr', x: cx, z: cz, y: U(19) + U(8) / 2, sx: 1.7, sy: U(8), sz: 1.7, c: C3(150, 145, 135), rot: Math.PI / 4 });
      break;
    case B_PARK:
      out.push({ k: 'sph', x: cx + 0.1, z: cz - 0.18, y: 0.01, sx: 0.5, sy: 0.03, sz: 0.32, c: C3(58, 126, 194) });
      out.push({ k: 'box', x: cx - 0.05, z: cz + 0.1, y: 0.05, sx: 0.3, sy: 0.06, sz: 0.08, c: C3(122, 88, 54) });
      break;
    case B_ZOO:
      out.push({ k: 'box', x: cx + 0.1, z: cz - 0.2, y: U(11) / 2, sx: 0.8, sy: U(11), sz: 0.6, c: C3(255, 220, 170), mat: 'brick' });
      out.push({ k: 'pyr', x: cx + 0.1, z: cz - 0.2, y: U(11) + U(8) / 2, sx: 0.9, sy: U(8), sz: 0.9, c: C3(170, 115, 80), mat: 'shingle', rot: Math.PI / 4 });
      out.push({ k: 'sph', x: ax + 0.7, z: az + 2.4, y: 0.02, sx: 1.1, sy: 0.04, sz: 0.55, c: C3(58, 126, 194) });
      break;
    case B_STADIUM: {
      out.push({ k: 'cyl', x: cx, z: cz, y: U(18) / 2, sx: 3.9, sy: U(18), sz: 3.2, c: C3(255, 255, 255), mat: 'conc' });
      out.push({ k: 'cyl', x: cx, z: cz, y: U(18), sx: 3.3, sy: U(4), sz: 2.6, c: C3(90, 96, 105) });
      out.push({ k: 'cyl', x: cx, z: cz, y: U(19), sx: 2.6, sy: U(4), sz: 1.9, c: C3(84, 163, 73) });
      for (const [lx, lz] of [[-1.7, -1.3], [1.7, -1.3], [-1.7, 1.3], [1.7, 1.3]]) {
        out.push({ k: 'cyl', x: cx + lx, z: cz + lz, y: U(40) / 2, sx: 0.07, sy: U(40), sz: 0.07, c: C3(154, 162, 172) });
        out.push({ k: 'box', x: cx + lx, z: cz + lz, y: U(40), sx: 0.35, sy: 0.14, sz: 0.08, c: C3(255, 250, 215), mat: 'glow' });
      }
      break;
    }
    case B_MARINA:
      out.push({ k: 'box', x: cx - 0.3, z: cz - 0.3, y: U(10) / 2, sx: 0.8, sy: U(10), sz: 0.8, c: C3(206, 196, 176) });
      out.push({ k: 'pyr', x: cx - 0.3, z: cz - 0.3, y: U(10) + U(6) / 2, sx: 0.9, sy: U(6), sz: 0.9, c: C3(120, 155, 190), mat: 'shingle', rot: Math.PI / 4 });
      out.push({ k: 'box', x: cx + 0.55, z: cz + 0.3, y: 0.05, sx: 1.0, sy: 0.05, sz: 0.16, c: C3(185, 162, 115) });
      break;
    case B_PUMP:
      out.push({ k: 'box', x: cx, z: cz, y: U(12) / 2, sx: 0.4, sy: U(12), sz: 0.4, c: C3(88, 134, 178), mat: 'metal' });
      out.push({ k: 'cyl', x: cx, z: cz, y: U(15), sx: 0.3, sy: 0.1, sz: 0.3, c: C3(216, 230, 242) });
      break;
    case B_WTOWER:
      out.push({ k: 'cyl', x: cx, z: cz, y: U(35) / 2, sx: 0.16, sy: U(35), sz: 0.16, c: C3(119, 128, 138) });
      out.push({ k: 'sph', x: cx, z: cz, y: U(40), sx: 1.1, sy: 0.85, sz: 1.1, c: C3(125, 178, 224), mat: 'metal' });
      break;
    case B_AIRPORT:
      out.push({ k: 'box', x: ax + 1.6, z: az + 2.5, y: U(17) / 2, sx: 2.0, sy: U(17), sz: 1.0, c: C3(255, 255, 255), mat: 'glass' });
      out.push({ k: 'cyl', x: ax + 3.2, z: az + 2.6, y: U(35) / 2, sx: 0.35, sy: U(35), sz: 0.35, c: C3(255, 255, 255), mat: 'conc' });
      out.push({ k: 'box', x: ax + 3.2, z: az + 2.6, y: U(35) + U(9) / 2, sx: 0.64, sy: U(9), sz: 0.64, c: C3(70, 140, 185), mat: 'glass' });
      out.push({ k: 'cyl', x: ax + 1.5, z: az + 1.75, y: 0.12, sx: 0.16, sy: 0.9, sz: 0.16, c: C3(238, 241, 244), lie: true });
      out.push({ k: 'box', x: ax + 1.5, z: az + 1.75, y: 0.12, sx: 0.75, sy: 0.03, sz: 0.14, c: C3(238, 241, 244) });
      break;
    case B_SEAPORT: {
      out.push({ k: 'box', x: ax + 0.95, z: az + 0.9, y: U(15) / 2, sx: 1.3, sy: U(15), sz: 1.0, c: C3(255, 240, 220), mat: 'metal' });
      const cols = [C3(196, 84, 62), C3(66, 132, 186), C3(86, 162, 88), C3(206, 158, 62), C3(150, 96, 168)];
      for (let k = 0; k < 8; k++) {
        const u = 1.9 + (k % 3) * 0.38, v = 1.75 + ((k / 3) | 0) * 0.45;
        out.push({ k: 'box', x: ax + u, z: az + v, y: (0.12 + (k % 3) * 0.1) / 2, sx: 0.33, sy: 0.12 + (k % 3) * 0.1, sz: 0.4, c: cols[k % 5], mat: 'metal' });
      }
      out.push({ k: 'box', x: ax + 0.8, z: az + 2.4, y: U(42) / 2, sx: 0.1, sy: U(42), sz: 0.1, c: C3(216, 178, 58) });
      out.push({ k: 'box', x: ax + 1.55, z: az + 2.4, y: U(42), sx: 1.6, sy: 0.08, sz: 0.1, c: C3(216, 178, 58) });
      break;
    }
  }
}

/* ---------------- world (re)build ---------------- */
const _m4 = { m: null, q: null, s: null, p: null, c: null, e: null };
function m4init() {
  if (_m4.m) return;
  _m4.m = new THREE.Matrix4(); _m4.q = new THREE.Quaternion();
  _m4.s = new THREE.Vector3(); _m4.p = new THREE.Vector3();
  _m4.c = new THREE.Color(); _m4.e = new THREE.Euler();
}

function rebuild3DWorld(S) {
  m4init();
  const prims = [];
  const trees = [];
  const wirePts = [];

  for (let i = 0; i < NT; i++) {
    const x = i % W, y = (i / W) | 0;
    const t = S.type[i];
    const variant = (hash2(x, y, S.seed) * 97) | 0;
    if (t === B_NONE) {
      if (S.terr[i] === T_TREE) {
        const cnt = 1 + variant % 2;
        for (let k = 0; k < cnt; k++) {
          trees.push({
            x: x + 0.25 + hash2(k, variant, 31) * 0.5, z: y + 0.25 + hash2(variant, k, 37) * 0.5,
            kind: (variant + k) % 3 === 1 ? 'ball' : 'cone',
            s: 0.7 + hash2(k, variant, 41) * 0.6, tone: (variant + k) % 3,
          });
        }
      }
      continue;
    }
    if (t === B_WIRE || S.wireOn[i]) {
      prims.push({ k: 'cyl', x: x + 0.5, z: y + 0.5, y: 0.55, sx: 0.05, sy: 1.1, sz: 0.05, c: C3(122, 92, 56) });
      prims.push({ k: 'box', x: x + 0.5, z: y + 0.5, y: 1.02, sx: 0.4, sy: 0.04, sz: 0.04, c: C3(95, 72, 48) });
      const condu = (j) => S.wireOn[j] || (S.type[j] !== B_NONE && S.type[j] !== B_ROAD && S.type[j] !== B_RAIL);
      if (x < W - 1 && condu(i + 1)) wirePts.push(x + 0.5, 1.0, y + 0.5, x + 1.5, 1.0, y + 0.5);
      if (y < H - 1 && condu(i + W)) wirePts.push(x + 0.5, 1.0, y + 0.5, x + 0.5, 1.0, y + 1.5);
      if (t !== B_WIRE) { /* wire over road: also draw the street light below */ } else continue;
    }
    if (t === B_ROAD || t === B_RAIL) {
      // street lights on some road tiles
      if (t === B_ROAD && hash2(x, y, 87) < 0.28) {
        const side = hash2(y, x, 89) < 0.5 ? -0.42 : 0.42;
        const horiz = (x > 0 && (S.type[i - 1] === B_ROAD)) || (x < W - 1 && (S.type[i + 1] === B_ROAD));
        const lx = x + 0.5 + (horiz ? 0 : side), lz = y + 0.5 + (horiz ? side : 0);
        prims.push({ k: 'cyl', x: lx, z: lz, y: 0.35, sx: 0.035, sy: 0.7, sz: 0.035, c: C3(70, 74, 80) });
        prims.push({ k: 'box', x: lx, z: lz, y: 0.72, sx: 0.16, sy: 0.035, sz: 0.05, c: C3(255, 250, 215), mat: 'glow' });
      }
      continue;
    }
    if (t === B_RES || t === B_COM || t === B_IND) {
      if (S.lvl[i] > 0) zonePrims(t, S.lvl[i], variant, x + 0.5, y + 0.5, prims);
      continue;
    }
    if (S.anch[i] !== i) continue;
    civicPrims(t, x, y, prims);
    if (t === B_PARK || t === B_ZOO) {
      const n = BLD[t].size;
      const cnt = t === B_PARK ? 2 : 6;
      for (let k = 0; k < cnt; k++) {
        trees.push({
          x: x + 0.2 + hash2(k, i, 51) * (n - 0.4), z: y + 0.2 + hash2(i, k, 53) * (n - 0.4),
          kind: k % 2 ? 'ball' : 'cone', s: 0.7 + hash2(k, i, 55) * 0.5, tone: k % 3,
        });
      }
    }
  }

  // fill instanced pools
  R3D.counts.clear();
  R3D._spinners = [];
  for (const p of prims) {
    const mesh = poolFor(p.k, p.mat || 'plain');
    const key = p.k + ':' + (p.mat || 'plain');
    const idx2 = R3D.counts.get(key) || 0;
    if (idx2 >= mesh.instanceMatrix.count) continue;
    R3D.counts.set(key, idx2 + 1);
    _m4.p.set(p.x, p.y, p.z);
    _m4.e.set(p.tilt || 0, p.rot || 0, p.lie ? Math.PI / 2 : 0);
    _m4.q.setFromEuler(_m4.e);
    _m4.s.set(p.sx, p.sy, p.sz);
    _m4.m.compose(_m4.p, _m4.q, _m4.s);
    mesh.setMatrixAt(idx2, _m4.m);
    mesh.setColorAt(idx2, _m4.c.setHex(p.c).convertSRGBToLinear());
    if (p.spin) R3D._spinners.push({ mesh, idx: idx2, p });
  }
  for (const [key, mesh] of R3D.pools) {
    mesh.count = R3D.counts.get(key) || 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // trees
  const TONES = [C3(46, 106, 50), C3(62, 122, 46), C3(40, 96, 54)];
  let ti = 0, ci = 0, bi = 0;
  for (const tr of trees) {
    if (ti >= R3D.treeInst.trunk.instanceMatrix.count) break;
    const trunkH = 0.24 * tr.s;
    _m4.q.identity();
    _m4.p.set(tr.x, trunkH / 2, tr.z); _m4.s.set(tr.s, trunkH, tr.s);
    _m4.m.compose(_m4.p, _m4.q, _m4.s);
    R3D.treeInst.trunk.setMatrixAt(ti, _m4.m);
    R3D.treeInst.trunk.setColorAt(ti, _m4.c.setHex(C3(74, 54, 32)).convertSRGBToLinear());
    ti++;
    const col = _m4.c.setHex(TONES[tr.tone]).convertSRGBToLinear();
    if (tr.kind === 'cone') {
      const h = 0.8 * tr.s;
      _m4.p.set(tr.x, trunkH + h / 2 - 0.02, tr.z); _m4.s.set(tr.s, h, tr.s);
      _m4.m.compose(_m4.p, _m4.q, _m4.s);
      R3D.treeInst.cone.setMatrixAt(ci, _m4.m);
      R3D.treeInst.cone.setColorAt(ci, col);
      ci++;
    } else {
      _m4.p.set(tr.x, trunkH + 0.3 * tr.s, tr.z); _m4.s.set(tr.s, tr.s, tr.s);
      _m4.m.compose(_m4.p, _m4.q, _m4.s);
      R3D.treeInst.ball.setMatrixAt(bi, _m4.m);
      R3D.treeInst.ball.setColorAt(bi, col);
      bi++;
    }
  }
  R3D.treeInst.trunk.count = ti; R3D.treeInst.cone.count = ci; R3D.treeInst.ball.count = bi;
  for (const k in R3D.treeInst) {
    R3D.treeInst[k].instanceMatrix.needsUpdate = true;
    if (R3D.treeInst[k].instanceColor) R3D.treeInst[k].instanceColor.needsUpdate = true;
  }

  // power wires
  if (R3D.wireLines) { R3D.scene.remove(R3D.wireLines); R3D.wireLines.geometry.dispose(); }
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wirePts), 3));
  R3D.wireLines = new THREE.LineSegments(wgeo, new THREE.LineBasicMaterial({ color: 0x222226 }));
  R3D.scene.add(R3D.wireLines);

  rebuildWater(S);
}

/* ---------------- dynamic per-frame bits ---------------- */
function update3DDynamics(S, view) {
  m4init();
  const time = view.time;
  R3D._windUniform.value = time / 1000;

  // water flow
  if (R3D._waterMat && R3D._waterMat.normalMap) {
    R3D._waterMat.normalMap.offset.set((time / 14000) % 1, (time / 21000) % 1);
  }

  // wind turbine rotors
  if (R3D._spinners) {
    for (const sp of R3D._spinners) {
      _m4.p.set(sp.p.x, sp.p.y, sp.p.z);
      _m4.e.set(0, sp.p.rot || 0, time / 400);
      _m4.q.setFromEuler(_m4.e);
      _m4.s.set(sp.p.sx, sp.p.sy, sp.p.sz);
      _m4.m.compose(_m4.p, _m4.q, _m4.s);
      sp.mesh.setMatrixAt(sp.idx, _m4.m);
    }
    if (R3D._spinners.length) {
      const pl = R3D.pools.get('box:plain');
      if (pl) pl.instanceMatrix.needsUpdate = true;
    }
  }

  // cars near the camera (body + cabin)
  const cm = R3D.carMesh, ct = R3D.carTop;
  let cn = 0;
  const tx0 = clamp((R3D.target.x - 26) | 0, 0, W - 1), tx1 = clamp((R3D.target.x + 26) | 0, 0, W - 1);
  const tz0 = clamp((R3D.target.z - 26) | 0, 0, H - 1), tz1 = clamp((R3D.target.z + 26) | 0, 0, H - 1);
  for (let y = tz0; y <= tz1 && cn < R3D.MAX.car - 2; y++) {
    for (let x = tx0; x <= tx1 && cn < R3D.MAX.car - 2; x++) {
      const i = y * W + x;
      if (S.type[i] !== B_ROAD || S.traffic[i] <= 6) continue;
      let mask = 0;
      if (y > 0 && (S.type[i - W] === B_ROAD)) mask |= 1;
      if (x < W - 1 && (S.type[i + 1] === B_ROAD)) mask |= 2;
      if (y < H - 1 && (S.type[i + W] === B_ROAD)) mask |= 4;
      if (x > 0 && (S.type[i - 1] === B_ROAD)) mask |= 8;
      const axes = [];
      if ((mask & 1) || (mask & 4) || mask === 0) axes.push('v');
      if ((mask & 2) || (mask & 8)) axes.push('u');
      const lanes = S.traffic[i] > 55 ? [0.14, -0.14] : [S.traffic[i] % 2 ? 0.14 : -0.14];
      for (const axis of axes) {
        for (const lane of lanes) {
          const h = hash2(x * 3 + (axis === 'u' ? 1 : 0), y * 5 + lane * 10, 91);
          if (h < 0.35 || cn >= R3D.MAX.car) continue;
          const speed = 0.00035 + h * 0.0002;
          const dirSign = lane > 0 ? 1 : -1;
          let p = ((time * speed + h * 7) % 1 + 1) % 1;
          if (dirSign < 0) p = 1 - p;
          let u, v, rotY;
          if (axis === 'v') { u = 0.5 + lane; v = p; rotY = Math.PI / 2; }
          else { u = p; v = 0.5 + lane; rotY = 0; }
          const bob = Math.sin(time / 90 + h * 20) * 0.004;
          _m4.p.set(x + u, 0.065 + bob, y + v);
          _m4.e.set(0, rotY, 0); _m4.q.setFromEuler(_m4.e);
          _m4.s.set(1, 1, 1);
          _m4.m.compose(_m4.p, _m4.q, _m4.s);
          cm.setMatrixAt(cn, _m4.m);
          cm.setColorAt(cn, _m4.c.setStyle(CAR_COLORS[Math.floor(h * 23) % CAR_COLORS.length]).convertSRGBToLinear());
          _m4.p.y += 0.075;
          _m4.m.compose(_m4.p, _m4.q, _m4.s);
          ct.setMatrixAt(cn, _m4.m);
          cn++;
        }
      }
    }
  }
  cm.count = cn; ct.count = cn;
  cm.instanceMatrix.needsUpdate = true; ct.instanceMatrix.needsUpdate = true;
  if (cm.instanceColor) cm.instanceColor.needsUpdate = true;

  // smoke particles above powered stacks
  const pos = R3D.smokePts.geometry.attributes.position;
  let sn = 0;
  for (let y = tz0; y <= tz1 && sn < R3D.MAX.smoke - 3; y++) {
    for (let x = tx0; x <= tx1 && sn < R3D.MAX.smoke - 3; x++) {
      const i = y * W + x;
      if (S.anch[i] !== i || !S.pwr[i]) continue;
      const t = S.type[i];
      let spots = SMOKE_SPOTS[t];
      if (!spots && t === B_IND && S.lvl[i] >= 3) spots = indSmokeSpots(S.lvl[i]);
      if (!spots) continue;
      for (let s = 0; s < spots.length; s++) {
        const [su, sv, z] = spots[s];
        for (let k = 0; k < 4 && sn < R3D.MAX.smoke; k++) {
          const ph = (((time / 3200) + k / 4 + hash2(i, k + s * 3, 77)) % 1 + 1) % 1;
          pos.setXYZ(sn++,
            x + su + ph * 0.9 + Math.sin(ph * 7 + k) * 0.08,
            z / 16 + ph * 1.9,
            y + sv - ph * 0.35);
        }
      }
    }
  }
  for (let k = sn; k < R3D.MAX.smoke; k++) pos.setXYZ(k, 0, -50, 0);
  pos.needsUpdate = true;

  // fires + flickering fire light
  const fi = R3D.fireInst;
  let fn = 0, flx = 0, flz = 0;
  for (let i = 0; i < NT && fn < R3D.MAX.fire; i++) {
    if (!S.fire[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if (fn === 0) { flx = x + 0.5; flz = y + 0.5; }
    const fl = 0.7 + hash2(i, (time / 90) | 0, 3) * 0.8;
    _m4.p.set(x + 0.5, fl / 2, y + 0.5);
    _m4.q.identity();
    _m4.s.set(0.9, fl, 0.9);
    _m4.m.compose(_m4.p, _m4.q, _m4.s);
    fi.setMatrixAt(fn, _m4.m);
    fi.setColorAt(fn, _m4.c.setHex(hash2(i, (time / 130) | 0, 5) < 0.5 ? 0xff8c2a : 0xffc94d));
    fn++;
  }
  fi.count = fn;
  fi.instanceMatrix.needsUpdate = true;
  if (fi.instanceColor) fi.instanceColor.needsUpdate = true;
  if (fn > 0) {
    R3D.fireLight.position.set(flx, 1.2, flz);
    R3D.fireLight.intensity = 1.6 + Math.sin(time / 55) * 0.6 + Math.sin(time / 23) * 0.3;
  } else R3D.fireLight.intensity = 0;

  // ghost highlight
  const gh = R3D.ghostInst;
  let gn = 0;
  if (view.ghost) {
    const tiles = ghostTiles(view.ghost);
    gh.material.color.setHex(view.ghost.ok ? 0x7dff8c : 0xff6a5a);
    for (const [tx, ty] of tiles) {
      if (!inBounds(tx, ty) || gn >= R3D.MAX.ghost) continue;
      _m4.p.set(tx + 0.5, 0.08, ty + 0.5);
      _m4.e.set(-Math.PI / 2, 0, 0); _m4.q.setFromEuler(_m4.e);
      _m4.s.set(0.96, 0.96, 1);
      _m4.m.compose(_m4.p, _m4.q, _m4.s);
      gh.setMatrixAt(gn++, _m4.m);
    }
  }
  gh.count = gn;
  gh.instanceMatrix.needsUpdate = true;

  // remote cursors
  const cg = R3D.cursorGroup;
  const wanted = view.cursors ? view.cursors.length : 0;
  while (cg.children.length < wanted) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    cone.rotation.x = Math.PI;
    cg.add(cone);
  }
  while (cg.children.length > wanted) cg.remove(cg.children[cg.children.length - 1]);
  if (view.cursors) {
    view.cursors.forEach((c, k) => {
      const cone = cg.children[k];
      cone.position.set(c.x + 0.5, 1.15 + Math.sin(time / 300) * 0.1, c.y + 0.5);
      cone.material.color.setStyle(c.color).convertSRGBToLinear();
    });
  }

  // disasters
  const dg = R3D.disasterGroup;
  while (dg.children.length < S.disasters.length) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 2.6, 8, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x8d949c, transparent: true, opacity: 0.8 }));
    dg.add(cone);
  }
  while (dg.children.length > S.disasters.length) dg.remove(dg.children[dg.children.length - 1]);
  S.disasters.forEach((d, k) => {
    const m = dg.children[k];
    m.position.set(d.x + 0.5, 1.3, d.y + 0.5);
    if (d.kind === DIS_TORNADO) {
      m.rotation.y = time / 120;
      m.material.color.setHex(0x8d949c);
    } else {
      m.rotation.y = time / 700;
      m.material.color.setHex(0x8a3aa8);
    }
  });
}

/* ---------------- frame ---------------- */
let _lastFrameT = 0;
function render3D(S, view) {
  if (!R3D.ready) init3D();
  const cv = R3D.renderer.domElement;
  const pr = R3D.renderer.getPixelRatio();
  const wpx = Math.floor(cv.clientWidth * pr), hpx = Math.floor(cv.clientHeight * pr);
  if (cv.width !== wpx || cv.height !== hpx) {
    R3D.renderer.setSize(cv.clientWidth, cv.clientHeight, false);
    R3D.composer.setSize(cv.clientWidth, cv.clientHeight);
    R3D.camera.aspect = cv.clientWidth / cv.clientHeight;
    R3D.camera.updateProjectionMatrix();
    R3D._fxaa.material.uniforms.resolution.value.set(1 / (cv.clientWidth * pr), 1 / (cv.clientHeight * pr));
  }

  const dtMs = _lastFrameT ? Math.min(100, view.time - _lastFrameT) : 16;
  _lastFrameT = view.time;

  const worldKey = window.__worldStamp + ':' + Math.floor(S.tickCount / 12);
  const now = performance.now();
  if (worldKey !== R3D.worldKey && now - R3D.lastBuild > 150) {
    rebuild3DWorld(S);
    R3D.worldKey = worldKey;
    R3D.lastBuild = now;
  }
  const groundKey = worldKey + '|' + (view.overlay || '');
  if (groundKey !== R3D.groundKey && now - (R3D._lastGround || 0) > 300) {
    paintGroundCanvas(S, view.overlay);
    R3D.groundKey = groundKey;
    R3D._lastGround = now;
  }

  updateDayNight(dtMs);
  cam3DApply(dtMs);
  update3DDynamics(S, view);
  R3D.composer.render();
}
