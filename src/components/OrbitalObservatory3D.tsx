import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';

type InstrumentId = 'interferometer' | 'cryoem' | 'cryostat';
type CameraPreset = 'overview' | 'core' | 'optics';

interface ExplodablePart {
  mesh: THREE.Object3D;
  basePos: THREE.Vector3;
  explodeOffset: THREE.Vector3;
}

const INSTRUMENTS: Array<{
  id: InstrumentId;
  name: string;
  spec: string;
  grounded: boolean;
}> = [
  {
    id: 'interferometer',
    name: 'L2 Space Interferometer',
    spec: '6.5 m Gold Parabolic Primary · Kapton Sunshield · Ka-Band Waveguide',
    grounded: false,
  },
  {
    id: 'cryoem',
    name: '300 kV Cryo-EM Column',
    spec: 'Field-Emission Gun · LN2 Autoloader Dewar · 1.2 Å Atomic Resolution',
    grounded: true,
  },
  {
    id: 'cryostat',
    name: '12 mK Dilution Cryostat',
    spec: '4-Stage Gold-Plated OFHC Copper · Helical Coaxial RF Lines · Qubit Puck',
    grounded: true,
  },
];

function createRadialContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 120);
    grad.addColorStop(0, 'rgba(2, 4, 12, 0.72)');
    grad.addColorStop(0.5, 'rgba(3, 6, 18, 0.34)');
    grad.addColorStop(1, 'rgba(4, 6, 15, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default function OrbitalObservatory3D() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [activeInstrument, setActiveInstrument] = useState<InstrumentId>('interferometer');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('overview');
  const [explodeRatio, setExplodeRatio] = useState<number>(0);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(false);

  const stateBridgeRef = useRef<{
    instrument: InstrumentId;
    preset: CameraPreset;
    explode: number;
    resetTrigger: number;
  }>({
    instrument: 'interferometer',
    preset: 'overview',
    explode: 0,
    resetTrigger: 0,
  });

  useEffect(() => {
    stateBridgeRef.current.instrument = activeInstrument;
  }, [activeInstrument]);

  useEffect(() => {
    stateBridgeRef.current.preset = cameraPreset;
  }, [cameraPreset]);

  useEffect(() => {
    stateBridgeRef.current.explode = explodeRatio;
  }, [explodeRatio]);

  useEffect(() => {
    const container = stageRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      return;
    }

    const initW = Math.max(1, container.clientWidth);
    const initH = Math.max(1, container.clientHeight);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(initW, initH);
    renderer.domElement.className = 'block w-full h-full cursor-grab active:cursor-grabbing';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a18);
    scene.fog = new THREE.FogExp2(0x060a18, 0.045);

    const camera = new THREE.PerspectiveCamera(40, initW / initH, 0.1, 80);
    camera.position.set(4.1, 2.5, 4.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 2.4;
    controls.maxDistance = 10.5;
    controls.maxPolarAngle = Math.PI * 0.56;
    controls.target.set(0, 1.15, 0);

    // Studio PBR environment reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();

    // Warm key light + cool deep-space hemisphere fill + mint rim accent
    const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.35);
    keyLight.position.set(5.5, 7.5, 5.0);
    scene.add(keyLight);

    const hemiLight = new THREE.HemisphereLight(0x70a8ff, 0x090e22, 0.85);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x5df0a8, 0.9);
    rimLight.position.set(-5.0, 3.2, -4.5);
    scene.add(rimLight);

    // Subtle calibration floor grid + grounded radial contact shadow
    const disposables: Array<{ dispose: () => void }> = [];
    const shadowTex = createRadialContactShadowTexture();
    disposables.push(shadowTex);

    const floorShadowGeo = new THREE.PlaneGeometry(3.8, 3.8);
    floorShadowGeo.rotateX(-Math.PI / 2);
    const floorShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.85,
    });
    const floorShadowMesh = new THREE.Mesh(floorShadowGeo, floorShadowMat);
    floorShadowMesh.position.y = 0.004;
    scene.add(floorShadowMesh);
    disposables.push(floorShadowGeo, floorShadowMat);

    const floorRingGeo = new THREE.RingGeometry(1.65, 1.675, 96);
    floorRingGeo.rotateX(-Math.PI / 2);
    const floorRingMat = new THREE.MeshBasicMaterial({
      color: 0x5df0a8,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    });
    const floorRingMesh = new THREE.Mesh(floorRingGeo, floorRingMat);
    floorRingMesh.position.y = 0.006;
    scene.add(floorRingMesh);
    disposables.push(floorRingGeo, floorRingMat);

    // Shared Studio PBR Materials (varied roughness & metalness)
    const matBrushedTi = new THREE.MeshStandardMaterial({
      color: 0xb9c6dc,
      metalness: 0.84,
      roughness: 0.28,
    });
    const matMatteChassis = new THREE.MeshStandardMaterial({
      color: 0x1a243d,
      metalness: 0.35,
      roughness: 0.68,
    });
    const matGoldOptics = new THREE.MeshStandardMaterial({
      color: 0xf4be44,
      metalness: 0.95,
      roughness: 0.14,
    });
    const matCopperCryo = new THREE.MeshStandardMaterial({
      color: 0xd98a4e,
      metalness: 0.9,
      roughness: 0.2,
    });
    const matSolarCell = new THREE.MeshStandardMaterial({
      color: 0x102a5c,
      metalness: 0.65,
      roughness: 0.22,
    });
    const matMintEmitter = new THREE.MeshStandardMaterial({
      color: 0x5df0a8,
      emissive: 0x2fd38a,
      emissiveIntensity: 0.55,
      metalness: 0.2,
      roughness: 0.3,
    });
    const matKaptonFoil = new THREE.MeshStandardMaterial({
      color: 0x8e9bb8,
      metalness: 0.78,
      roughness: 0.38,
      side: THREE.DoubleSide,
    });
    disposables.push(
      matBrushedTi,
      matMatteChassis,
      matGoldOptics,
      matCopperCryo,
      matSolarCell,
      matMintEmitter,
      matKaptonFoil
    );

    const registerGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      disposables.push(g);
      return g;
    };

    const partsMap: Record<InstrumentId, ExplodablePart[]> = {
      interferometer: [],
      cryoem: [],
      cryostat: [],
    };

    const addPart = (
      id: InstrumentId,
      parent: THREE.Group,
      mesh: THREE.Object3D,
      explodeVec: THREE.Vector3
    ) => {
      parent.add(mesh);
      partsMap[id].push({
        mesh,
        basePos: mesh.position.clone(),
        explodeOffset: explodeVec,
      });
    };

    // -----------------------------------------------------------------------
    // ASSEMBLY 1: L2 Space Interferometer (8 Composite Parts)
    // -----------------------------------------------------------------------
    const groupInterferometer = new THREE.Group();
    groupInterferometer.position.y = 1.25;
    scene.add(groupInterferometer);

    // 1. Primary Spacecraft Bus
    const busGeo = registerGeo(new THREE.CylinderGeometry(0.42, 0.48, 0.62, 8));
    const busMesh = new THREE.Mesh(busGeo, matMatteChassis);
    busMesh.position.set(0, -0.38, 0);
    addPart('interferometer', groupInterferometer, busMesh, new THREE.Vector3(0, -0.45, 0));

    // 2. LatheGeometry Parabolic Gold Primary Mirror
    const dishPoints: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) {
      const r = (i / 16) * 1.15;
      const y = r * r * 0.24;
      dishPoints.push(new THREE.Vector2(r, y));
    }
    const dishGeo = registerGeo(new THREE.LatheGeometry(dishPoints, 36));
    const dishMesh = new THREE.Mesh(dishGeo, matGoldOptics);
    dishMesh.position.set(0, 0.02, 0);
    addPart('interferometer', groupInterferometer, dishMesh, new THREE.Vector3(0, 0.35, 0));

    // 3. Secondary Sub-Reflector Tripod & Mirror
    const secAssembly = new THREE.Group();
    secAssembly.position.set(0, 0.78, 0);
    const secMirror = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.18, 0.22, 0.06, 6)),
      matGoldOptics
    );
    secAssembly.add(secMirror);
    const focalRing = new THREE.Mesh(
      registerGeo(new THREE.TorusGeometry(0.21, 0.018, 12, 32)),
      matMintEmitter
    );
    focalRing.rotation.x = Math.PI / 2;
    focalRing.position.y = -0.04;
    secAssembly.add(focalRing);
    for (let s = 0; s < 3; s++) {
      const angle = (s * Math.PI * 2) / 3;
      const strut = new THREE.Mesh(
        registerGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.96, 8)),
        matBrushedTi
      );
      strut.position.set(Math.cos(angle) * 0.45, -0.34, Math.sin(angle) * 0.45);
      strut.lookAt(0, 0.82, 0);
      strut.rotateX(Math.PI / 2);
      secAssembly.add(strut);
    }
    addPart('interferometer', groupInterferometer, secAssembly, new THREE.Vector3(0, 0.75, 0));

    // 4. Layered Kapton Sunshield Membranes
    const shieldGroup = new THREE.Group();
    shieldGroup.position.set(0, -0.06, 0);
    for (let layer = 0; layer < 3; layer++) {
      const sGeo = registerGeo(new THREE.CylinderGeometry(1.38 - layer * 0.08, 1.44 - layer * 0.08, 0.012, 6));
      const sMesh = new THREE.Mesh(sGeo, matKaptonFoil);
      sMesh.position.y = -layer * 0.075;
      shieldGroup.add(sMesh);
    }
    addPart('interferometer', groupInterferometer, shieldGroup, new THREE.Vector3(0, -0.22, 0));

    // 5 & 6. Beveled ExtrudeGeometry Twin Solar Array Wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, -0.22);
    wingShape.lineTo(1.18, -0.16);
    wingShape.lineTo(1.18, 0.16);
    wingShape.lineTo(0, 0.22);
    wingShape.closePath();
    const wingGeo = registerGeo(
      new THREE.ExtrudeGeometry(wingShape, {
        depth: 0.025,
        bevelEnabled: true,
        bevelSegments: 2,
        steps: 1,
        bevelSize: 0.012,
        bevelThickness: 0.012,
      })
    );

    const leftWing = new THREE.Mesh(wingGeo, matSolarCell);
    leftWing.position.set(0.48, -0.38, -0.01);
    addPart('interferometer', groupInterferometer, leftWing, new THREE.Vector3(0.75, -0.15, 0));

    const rightWing = new THREE.Mesh(wingGeo, matSolarCell);
    rightWing.rotation.y = Math.PI;
    rightWing.position.set(-0.48, -0.38, 0.01);
    addPart('interferometer', groupInterferometer, rightWing, new THREE.Vector3(-0.75, -0.15, 0));

    // 7. TubeGeometry Ka-Band Telemetry Waveguide
    const waveCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.28, -0.58, 0.25),
      new THREE.Vector3(0.62, -0.78, 0.42),
      new THREE.Vector3(0.55, -0.96, 0.65),
    ]);
    const waveGeo = registerGeo(new THREE.TubeGeometry(waveCurve, 24, 0.024, 10, false));
    const waveMesh = new THREE.Mesh(waveGeo, matCopperCryo);
    addPart('interferometer', groupInterferometer, waveMesh, new THREE.Vector3(0.4, -0.55, 0.4));

    // 8. High-Gain Downlink Dish
    const downlinkDish = new THREE.Mesh(
      registerGeo(new THREE.ConeGeometry(0.22, 0.14, 24, 1, true)),
      matBrushedTi
    );
    downlinkDish.position.set(0.55, -1.0, 0.68);
    downlinkDish.rotation.x = Math.PI * 0.65;
    addPart('interferometer', groupInterferometer, downlinkDish, new THREE.Vector3(0.55, -0.75, 0.55));

    // -----------------------------------------------------------------------
    // ASSEMBLY 2: 300 kV Cryo-EM Structural Microscope (Bottom-Center Pivot y=0)
    // -----------------------------------------------------------------------
    const groupCryoEm = new THREE.Group();
    groupCryoEm.visible = false;
    scene.add(groupCryoEm);

    // 1. Vibration-Isolated Pedestal Plinth (sits flush at y=0)
    const plinthMesh = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.92, 1.02, 0.22, 12)),
      matMatteChassis
    );
    plinthMesh.position.set(0, 0.11, 0);
    addPart('cryoem', groupCryoEm, plinthMesh, new THREE.Vector3(0, -0.15, 0));

    // 2. Lower Projection Chamber
    const projChamber = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.46, 0.56, 0.82, 16)),
      matBrushedTi
    );
    projChamber.position.set(0, 0.63, 0);
    addPart('cryoem', groupCryoEm, projChamber, new THREE.Vector3(0, 0.05, 0));

    // 3. Specimen Autoloader & Goniometer Stage Ring
    const stageGroup = new THREE.Group();
    stageGroup.position.set(0, 1.24, 0);
    const stageCollar = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.52, 0.52, 0.38, 24)),
      matMatteChassis
    );
    stageGroup.add(stageCollar);
    const gonioPort = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.11, 0.11, 0.68, 16)),
      matGoldOptics
    );
    gonioPort.rotation.z = Math.PI / 2;
    stageGroup.add(gonioPort);
    const beamWindow = new THREE.Mesh(
      registerGeo(new THREE.TorusGeometry(0.53, 0.02, 12, 36)),
      matMintEmitter
    );
    beamWindow.rotation.x = Math.PI / 2;
    stageGroup.add(beamWindow);
    addPart('cryoem', groupCryoEm, stageGroup, new THREE.Vector3(0, 0.35, 0.35));

    // 4. Upper Objective & Condenser Lens Column
    const upperCol = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.42, 0.46, 0.86, 24)),
      matBrushedTi
    );
    upperCol.position.set(0, 1.86, 0);
    addPart('cryoem', groupCryoEm, upperCol, new THREE.Vector3(0, 0.6, 0));

    // 5. LatheGeometry Field-Emission Gun (FEG) High-Voltage Crown
    const fegPts = [
      new THREE.Vector2(0.0, 0.56),
      new THREE.Vector2(0.26, 0.54),
      new THREE.Vector2(0.38, 0.38),
      new THREE.Vector2(0.41, 0.0),
    ];
    const fegCrown = new THREE.Mesh(registerGeo(new THREE.LatheGeometry(fegPts, 28)), matGoldOptics);
    fegCrown.position.set(0, 2.29, 0);
    addPart('cryoem', groupCryoEm, fegCrown, new THREE.Vector3(0, 1.05, 0));

    // 6. Side LN2 Cryo-Dewar Vessel
    const dewarMesh = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.28, 0.28, 0.72, 24)),
      matKaptonFoil
    );
    dewarMesh.position.set(-0.78, 1.48, 0.18);
    addPart('cryoem', groupCryoEm, dewarMesh, new THREE.Vector3(-0.65, 0.25, 0.2));

    // 7. TubeGeometry Cryogenic Transfer Line
    const cryoCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.78, 1.84, 0.18),
      new THREE.Vector3(-0.64, 2.06, 0.12),
      new THREE.Vector3(-0.38, 1.32, 0.06),
    ]);
    const cryoTube = new THREE.Mesh(
      registerGeo(new THREE.TubeGeometry(cryoCurve, 28, 0.032, 12, false)),
      matCopperCryo
    );
    addPart('cryoem', groupCryoEm, cryoTube, new THREE.Vector3(-0.45, 0.45, 0.15));

    // -----------------------------------------------------------------------
    // ASSEMBLY 3: 12 mK Quantum Dilution Cryostat (Bottom-Center Pivot y=0)
    // -----------------------------------------------------------------------
    const groupCryostat = new THREE.Group();
    groupCryostat.visible = false;
    scene.add(groupCryostat);

    // 1. Base Vacuum Manifold Pedestal (y=0)
    const cryoBase = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.95, 1.05, 0.18, 32)),
      matMatteChassis
    );
    cryoBase.position.set(0, 0.09, 0);
    addPart('cryostat', groupCryostat, cryoBase, new THREE.Vector3(0, -0.2, 0));

    // 2. Top 300K Flange Frame & Support Columns
    const frameGroup = new THREE.Group();
    const topFlange = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.92, 0.92, 0.1, 32)),
      matBrushedTi
    );
    topFlange.position.y = 2.48;
    frameGroup.add(topFlange);
    for (let c = 0; c < 4; c++) {
      const ang = (c * Math.PI) / 2 + Math.PI / 4;
      const rod = new THREE.Mesh(
        registerGeo(new THREE.CylinderGeometry(0.035, 0.035, 2.35, 12)),
        matBrushedTi
      );
      rod.position.set(Math.cos(ang) * 0.82, 1.28, Math.sin(ang) * 0.82);
      frameGroup.add(rod);
    }
    addPart('cryostat', groupCryostat, frameGroup, new THREE.Vector3(0, 0.65, 0));

    // 3–6. Four Stepped Gold-Plated OFHC Copper Cooling Stages (50K -> 4K -> Still -> 12mK Mixing)
    const stageHeights = [2.05, 1.62, 1.18, 0.74];
    const stageRadii = [0.72, 0.62, 0.52, 0.42];
    stageHeights.forEach((h, idx) => {
      const plateGroup = new THREE.Group();
      plateGroup.position.set(0, h, 0);
      const plate = new THREE.Mesh(
        registerGeo(new THREE.CylinderGeometry(stageRadii[idx], stageRadii[idx], 0.055, 32)),
        idx === 3 ? matCopperCryo : matGoldOptics
      );
      plateGroup.add(plate);

      if (idx < 3) {
        for (let r = 0; r < 3; r++) {
          const theta = (r * Math.PI * 2) / 3 + idx * 0.4;
          const standoff = new THREE.Mesh(
            registerGeo(new THREE.CylinderGeometry(0.02, 0.02, 0.42, 10)),
            matCopperCryo
          );
          standoff.position.set(
            Math.cos(theta) * (stageRadii[idx] * 0.72),
            -0.21,
            Math.sin(theta) * (stageRadii[idx] * 0.72)
          );
          plateGroup.add(standoff);
        }
      }
      addPart(
        'cryostat',
        groupCryostat,
        plateGroup,
        new THREE.Vector3(0, (2 - idx) * 0.28, 0)
      );
    });

    // 7. Helical Coaxial Microwave Attenuator Lines (TubeGeometry)
    const rfGroup = new THREE.Group();
    for (let line = 0; line < 4; line++) {
      const baseAngle = (line * Math.PI) / 2;
      const helixPts: THREE.Vector3[] = [];
      for (let step = 0; step <= 20; step++) {
        const t = step / 20;
        const a = baseAngle + t * Math.PI * 1.6;
        const rad = 0.24 + (1 - t) * 0.22;
        helixPts.push(new THREE.Vector3(Math.cos(a) * rad, 2.02 - t * 1.28, Math.sin(a) * rad));
      }
      const rfGeo = registerGeo(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helixPts), 36, 0.012, 8, false)
      );
      rfGroup.add(new THREE.Mesh(rfGeo, matBrushedTi));
    }
    addPart('cryostat', groupCryostat, rfGroup, new THREE.Vector3(0.55, 0.15, 0));

    // 8. Superconducting Qubit Processor Shield Puck
    const qubitPuck = new THREE.Group();
    qubitPuck.position.set(0, 0.44, 0);
    const puckBody = new THREE.Mesh(
      registerGeo(new THREE.CylinderGeometry(0.22, 0.18, 0.34, 24)),
      matMatteChassis
    );
    qubitPuck.add(puckBody);
    const puckGlow = new THREE.Mesh(
      registerGeo(new THREE.TorusGeometry(0.225, 0.016, 12, 32)),
      matMintEmitter
    );
    puckGlow.rotation.x = Math.PI / 2;
    qubitPuck.add(puckGlow);
    addPart('cryostat', groupCryostat, qubitPuck, new THREE.Vector3(0, -0.35, 0));

    // Camera Presets
    const presetTargets: Record<CameraPreset, { pos: THREE.Vector3; look: THREE.Vector3 }> = {
      overview: { pos: new THREE.Vector3(4.1, 2.5, 4.8), look: new THREE.Vector3(0, 1.2, 0) },
      core: { pos: new THREE.Vector3(2.35, 1.35, 2.65), look: new THREE.Vector3(0, 1.15, 0) },
      optics: { pos: new THREE.Vector3(1.6, 3.35, 2.5), look: new THREE.Vector3(0, 1.65, 0) },
    };

    let activePresetApplied: CameraPreset | null = 'overview';
    let lastResetSeen = 0;
    let currentExplode = 0;
    let isTransitioningCamera = false;
    const desiredCamPos = presetTargets.overview.pos.clone();
    const desiredLook = presetTargets.overview.look.clone();

    const onPointerDown = () => {
      isTransitioningCamera = false;
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    const clock = new THREE.Clock();
    let rafId = 0;
    let isDisposed = false;

    const animate = () => {
      if (isDisposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.elapsedTime;
      const bridge = stateBridgeRef.current;

      // Toggle active composite assembly visibility
      groupInterferometer.visible = bridge.instrument === 'interferometer';
      groupCryoEm.visible = bridge.instrument === 'cryoem';
      groupCryostat.visible = bridge.instrument === 'cryostat';

      const isGrounded = bridge.instrument !== 'interferometer';
      floorShadowMesh.visible = isGrounded;
      floorRingMesh.visible = true;

      // Gentle orbital hover on floating space interferometer
      if (bridge.instrument === 'interferometer') {
        groupInterferometer.position.y = 1.28 + Math.sin(elapsed * 1.15) * 0.06;
        groupInterferometer.rotation.y += dt * 0.22;
      } else if (bridge.instrument === 'cryoem') {
        groupCryoEm.rotation.y += dt * 0.14;
      } else {
        groupCryostat.rotation.y += dt * 0.16;
      }

      // Smoothly damp exploded-assembly offsets (zero per-frame allocations)
      currentExplode = THREE.MathUtils.damp(currentExplode, bridge.explode, 7.5, dt);
      const activeParts = partsMap[bridge.instrument];
      for (let i = 0; i < activeParts.length; i++) {
        const p = activeParts[i];
        p.mesh.position.set(
          p.basePos.x + p.explodeOffset.x * currentExplode,
          p.basePos.y + p.explodeOffset.y * currentExplode,
          p.basePos.z + p.explodeOffset.z * currentExplode
        );
      }

      // Apply camera preset transitions smoothly when requested
      if (bridge.preset !== activePresetApplied || bridge.resetTrigger !== lastResetSeen) {
        activePresetApplied = bridge.preset;
        lastResetSeen = bridge.resetTrigger;
        desiredCamPos.copy(presetTargets[bridge.preset].pos);
        desiredLook.copy(presetTargets[bridge.preset].look);
        isTransitioningCamera = true;
      }

      if (isTransitioningCamera) {
        camera.position.lerp(desiredCamPos, 1 - Math.exp(-5.5 * dt));
        controls.target.lerp(desiredLook, 1 - Math.exp(-5.5 * dt));
        if (camera.position.distanceTo(desiredCamPos) < 0.04) {
          isTransitioningCamera = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);
      rafId = window.requestAnimationFrame(animate);
    };

    rafId = window.requestAnimationFrame(animate);

    const resizeObs = new ResizeObserver(() => {
      if (isDisposed || !container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObs.observe(container);

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(rafId);
      resizeObs.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      envRT.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const currentMeta = INSTRUMENTS.find((i) => i.id === activeInstrument) || INSTRUMENTS[0];

  return (
    <section id="observatory-3d" className="mx-auto max-w-6xl px-5 sm:px-8 py-16">
      <div className="reveal-block flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-[#5df0a8] mb-2">
              Interactive 3D PBR Hardware Inspector · Three.js Studio Scene
            </p>
            <h2
              className="text-2xl sm:text-4xl font-bold tracking-tight text-[#f3f6ff]"
              style={{ textWrap: 'balance' }}
            >
              Frontier Scientific Instrumentation
            </h2>
          </div>
          <p className="text-xs text-[#9aa6c4]">
            Drag to orbit · Scroll to zoom · Slide Exploded View to inspect multi-part sub-assemblies
          </p>
        </div>

        {/* Viewport-First 3D Canvas Container */}
        <div className="relative h-[480px] sm:h-[540px] w-full rounded-2xl overflow-hidden border border-[#96afe6]/20 bg-[#060a18]">
          <div ref={stageRef} className="w-full h-full" />

          {/* Minimal Top-Left Unboxed Instrument Caption (pointer-events-none) */}
          <div className="pointer-events-none absolute top-4 left-5 right-5 flex items-start justify-between gap-4">
            <div>
              <div className="text-sm sm:text-base font-bold text-[#f3f6ff] tracking-tight">
                {currentMeta.name}
              </div>
              <div className="mt-0.5 text-xs text-[#9aa6c4]">{currentMeta.spec}</div>
            </div>
          </div>

          {/* Collapsible Floating Control Dock (<= 15% viewport footprint, solid rgba, NO backdrop-filter) */}
          <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-[440px] rounded-xl border border-[#96afe6]/22 bg-[#090e21]/95 p-3 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 overflow-x-auto">
                {INSTRUMENTS.map((inst) => (
                  <button
                    key={inst.id}
                    type="button"
                    onClick={() => setActiveInstrument(inst.id)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                      activeInstrument === inst.id
                        ? 'bg-[#5df0a8] text-[#032018] font-semibold'
                        : 'text-[#9aa6c4] hover:text-[#f3f6ff] bg-[#0e1630]'
                    }`}
                  >
                    {inst.id === 'interferometer'
                      ? 'Interferometer'
                      : inst.id === 'cryoem'
                        ? 'Cryo-EM'
                        : 'Cryostat'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setExplodeRatio(0);
                    setCameraPreset('overview');
                    stateBridgeRef.current.resetTrigger += 1;
                  }}
                  title="Reset camera and assembly"
                  className="p-1.5 rounded-lg text-[#9aa6c4] hover:text-[#f3f6ff] bg-[#0e1630] cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDockCollapsed((prev) => !prev)}
                  aria-label={dockCollapsed ? 'Expand 3D controls' : 'Collapse 3D controls'}
                  className="p-1.5 rounded-lg text-[#9aa6c4] hover:text-[#f3f6ff] bg-[#0e1630] cursor-pointer"
                >
                  {dockCollapsed ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>

            {!dockCollapsed && (
              <div className="mt-3 pt-2.5 border-t border-[#96afe6]/14 flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#9aa6c4] whitespace-nowrap">Camera View</span>
                  <div className="flex items-center gap-1">
                    {(['overview', 'core', 'optics'] as CameraPreset[]).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => {
                          setCameraPreset(preset);
                          stateBridgeRef.current.resetTrigger += 1;
                        }}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium capitalize whitespace-nowrap cursor-pointer ${
                          cameraPreset === preset
                            ? 'bg-[#192852] text-[#5df0a8] border border-[#5df0a8]/40'
                            : 'text-[#9aa6c4] hover:text-[#f3f6ff]'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center justify-between gap-3 text-xs text-[#9aa6c4]">
                  <span className="whitespace-nowrap">Exploded Assembly</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={explodeRatio}
                    onChange={(e) => setExplodeRatio(Number(e.target.value))}
                    className="flex-1 accent-[#5df0a8] cursor-pointer"
                  />
                  <span className="font-mono-tabular w-9 text-right text-[#f3f6ff]">
                    {Math.round(explodeRatio * 100)}%
                  </span>
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
