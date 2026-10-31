import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Volume2, VolumeX, Pause, Play, RotateCcw, ArrowLeft } from 'lucide-react';
import {
  recordOrbitalMissionScore,
  subscribeOrbitalLeaderboard,
  type OrbitalLeaderboardEntry,
  type User,
} from '../lib/firebase';

type GamePhase = 'title' | 'playing' | 'paused' | 'victory' | 'gameover';

interface OrbitalDefenseGameProps {
  currentUser: User | null;
  onExitGame: () => void;
}

// Procedural Web Audio API Synthesizer (zero external audio dependencies)
class OrbitalSoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  playLaser() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(780, now);
    osc.frequency.exponentialRampToValueAtTime(190, now + 0.09);
    gain.gain.setValueAtTime(0.11, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playDash() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(620, now + 0.14);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playPickup() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.045);
      gain.gain.setValueAtTime(0.09, now + i * 0.045);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.045 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.045);
      osc.stop(now + i * 0.045 + 0.15);
    });
  }

  playExplosion(heavy = false) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(heavy ? 150 : 240, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + (heavy ? 0.28 : 0.16));
    gain.gain.setValueAtTime(heavy ? 0.18 : 0.1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (heavy ? 0.29 : 0.17));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (heavy ? 0.3 : 0.18));
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}

const VICTORY_SCORE = 1500;

export default function OrbitalDefenseGame({
  currentUser,
  onExitGame,
}: OrbitalDefenseGameProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sfxRef = useRef<OrbitalSoundEngine | null>(null);

  const [phase, setPhase] = useState<GamePhase>('title');
  const [score, setScore] = useState<number>(0);
  const [hull, setHull] = useState<number>(3);
  const [wave, setWave] = useState<number>(1);
  const [muted, setMuted] = useState<boolean>(false);
  const [bestLocal, setBestLocal] = useState<number>(() => {
    try {
      return Number(window.localStorage.getItem('ascend_orbital_best') || '0') || 0;
    } catch {
      return 0;
    }
  });
  const [leaderboard, setLeaderboard] = useState<OrbitalLeaderboardEntry[]>([]);

  const phaseRef = useRef<GamePhase>('title');
  const commandQueueRef = useRef<'start' | 'resume' | 'pause' | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Subscribe to Firestore pilot leaderboard if authenticated
  useEffect(() => {
    const unsub = subscribeOrbitalLeaderboard(currentUser, setLeaderboard);
    return () => {
      if (unsub) unsub();
    };
  }, [currentUser]);

  const recordRunCompletion = useCallback(
    (finalScore: number, finalWave: number) => {
      setBestLocal((prev) => {
        const next = Math.max(prev, finalScore);
        try {
          window.localStorage.setItem('ascend_orbital_best', String(next));
        } catch {
          // ignore
        }
        return next;
      });
      if (currentUser && currentUser.emailVerified && finalScore > 0) {
        void recordOrbitalMissionScore(currentUser, finalScore, finalWave).catch(() => {
          // Logged by handleFirestoreError
        });
      }
    },
    [currentUser]
  );

  const triggerStartMission = useCallback(() => {
    commandQueueRef.current = 'start';
    setScore(0);
    setHull(3);
    setWave(1);
    setPhase('playing');
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (sfxRef.current) sfxRef.current.muted = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const sfx = new OrbitalSoundEngine();
    sfxRef.current = sfx;

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

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.className = 'block w-full h-full';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03050d);
    scene.fog = new THREE.FogExp2(0x03050d, 0.022);

    const camera = new THREE.PerspectiveCamera(
      52,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.1,
      140
    );
    const baseCamPos = new THREE.Vector3(0, 4.4, 9.8);
    camera.position.copy(baseCamPos);
    camera.lookAt(0, 0.2, -8);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;
    pmrem.dispose();

    const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sunLight.position.set(8, 12, 6);
    scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x5fa4ff, 0x050918, 0.85);
    scene.add(hemiLight);

    const disposables: Array<{ dispose: () => void }> = [];
    const reg = <T extends { dispose: () => void }>(r: T): T => {
      disposables.push(r);
      return r;
    };

    // Distant Earth Limb Curve at Horizon + Starfield
    const earthHorizonGeo = reg(new THREE.SphereGeometry(26, 64, 48));
    const earthHorizonMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0x0d2b66,
        emissive: 0x0a214f,
        emissiveIntensity: 0.45,
        roughness: 0.6,
        metalness: 0.2,
      })
    );
    const earthHorizon = new THREE.Mesh(earthHorizonGeo, earthHorizonMat);
    earthHorizon.position.set(0, -28.5, -24);
    scene.add(earthHorizon);

    const starCount = 900;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i * 3] = (Math.random() - 0.5) * 90;
      starPos[i * 3 + 1] = (Math.random() - 0.2) * 50;
      starPos[i * 3 + 2] = -Math.random() * 110;
    }
    const starGeo = reg(new THREE.BufferGeometry());
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = reg(
      new THREE.PointsMaterial({
        color: 0xcfe2ff,
        size: 0.16,
        transparent: true,
        opacity: 0.85,
      })
    );
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // Subtle Orbital Flight Lane Rails
    const railGroup = new THREE.Group();
    const railGeo = reg(new THREE.BoxGeometry(0.03, 0.03, 90));
    const railMat = reg(
      new THREE.MeshBasicMaterial({
        color: 0x5df0a8,
        transparent: true,
        opacity: 0.16,
      })
    );
    [-6.6, 6.6].forEach((rx) => {
      const rMesh = new THREE.Mesh(railGeo, railMat);
      rMesh.position.set(rx, -1.6, -35);
      railGroup.add(rMesh);
    });
    scene.add(railGroup);

    // -----------------------------------------------------------------------
    // Composite Multi-Part Player Interceptor (`THREE.Group`, 7 distinct parts)
    // -----------------------------------------------------------------------
    const shipGroup = new THREE.Group();
    scene.add(shipGroup);

    const matHull = reg(
      new THREE.MeshStandardMaterial({ color: 0xd8e4fa, metalness: 0.82, roughness: 0.24 })
    );
    const matDarkTrim = reg(
      new THREE.MeshStandardMaterial({ color: 0x16223b, metalness: 0.5, roughness: 0.55 })
    );
    const matGoldNose = reg(
      new THREE.MeshStandardMaterial({ color: 0xf4be44, metalness: 0.94, roughness: 0.16 })
    );
    const matIonGlow = reg(
      new THREE.MeshBasicMaterial({ color: 0x5df0a8 })
    );

    // Fuselage
    const fuselage = new THREE.Mesh(
      reg(new THREE.CylinderGeometry(0.18, 0.34, 1.65, 8)),
      matHull
    );
    fuselage.rotation.x = Math.PI / 2;
    shipGroup.add(fuselage);

    // Gold Optical Sensor Nosecone
    const nose = new THREE.Mesh(reg(new THREE.ConeGeometry(0.18, 0.52, 8)), matGoldNose);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -1.08;
    shipGroup.add(nose);

    // Canopy
    const canopy = new THREE.Mesh(reg(new THREE.BoxGeometry(0.24, 0.16, 0.62)), matDarkTrim);
    canopy.position.set(0, 0.18, -0.15);
    shipGroup.add(canopy);

    // Swept Delta Wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(1.25, -0.55);
    wingShape.lineTo(1.25, -0.82);
    wingShape.lineTo(0, -0.62);
    wingShape.closePath();
    const wingExtrude = reg(
      new THREE.ExtrudeGeometry(wingShape, {
        depth: 0.05,
        bevelEnabled: true,
        bevelSize: 0.015,
        bevelThickness: 0.015,
        bevelSegments: 2,
      })
    );
    const rightWing = new THREE.Mesh(wingExtrude, matHull);
    rightWing.rotation.x = Math.PI / 2;
    rightWing.position.set(0.2, 0.02, -0.22);
    shipGroup.add(rightWing);

    const leftWing = new THREE.Mesh(wingExtrude, matHull);
    leftWing.rotation.x = Math.PI / 2;
    leftWing.scale.x = -1;
    leftWing.position.set(-0.2, 0.02, -0.22);
    shipGroup.add(leftWing);

    // Twin Ion Thruster Nozzles
    [-0.22, 0.22].forEach((tx) => {
      const thruster = new THREE.Mesh(
        reg(new THREE.CylinderGeometry(0.09, 0.12, 0.22, 12)),
        matIonGlow
      );
      thruster.rotation.x = Math.PI / 2;
      thruster.position.set(tx, 0, 0.9);
      shipGroup.add(thruster);
    });

    // -----------------------------------------------------------------------
    // Pooled Entities: Pulse Bolts, Hazard Drones, Telemetry Cores, Particles
    // -----------------------------------------------------------------------
    const boltGeo = reg(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 8));
    boltGeo.rotateX(Math.PI / 2);
    const boltMat = reg(new THREE.MeshBasicMaterial({ color: 0x5df0a8 }));

    interface Bolt {
      mesh: THREE.Mesh;
      active: boolean;
    }
    const bolts: Bolt[] = Array.from({ length: 24 }, () => {
      const m = new THREE.Mesh(boltGeo, boltMat);
      m.visible = false;
      scene.add(m);
      return { mesh: m, active: false };
    });

    const hazardCoreGeo = reg(new THREE.OctahedronGeometry(0.56, 1));
    const hazardPanelGeo = reg(new THREE.BoxGeometry(1.75, 0.06, 0.36));
    const telegraphGeo = reg(new THREE.RingGeometry(0.66, 0.78, 24));

    interface Hazard {
      group: THREE.Group;
      coreMat: THREE.MeshStandardMaterial;
      telegraph: THREE.Mesh;
      active: boolean;
      hp: number;
      windup: number;
      speed: number;
      flashTimer: number;
      spinSpeed: number;
    }

    const hazards: Hazard[] = Array.from({ length: 18 }, () => {
      const g = new THREE.Group();
      const cMat = reg(
        new THREE.MeshStandardMaterial({
          color: 0x8b96ad,
          metalness: 0.72,
          roughness: 0.34,
          emissive: 0xef4444,
          emissiveIntensity: 0.2,
        })
      );
      const core = new THREE.Mesh(hazardCoreGeo, cMat);
      const panels = new THREE.Mesh(hazardPanelGeo, matDarkTrim);
      const teleMat = reg(
        new THREE.MeshBasicMaterial({
          color: 0xf43f5e,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        })
      );
      const tele = new THREE.Mesh(telegraphGeo, teleMat);
      g.add(core, panels, tele);
      g.visible = false;
      scene.add(g);
      return {
        group: g,
        coreMat: cMat,
        telegraph: tele,
        active: false,
        hp: 2,
        windup: 0,
        speed: 14,
        flashTimer: 0,
        spinSpeed: 1.5,
      };
    });

    // Data Cores (Collectible Pickups)
    const corePickupGeo = reg(new THREE.OctahedronGeometry(0.38, 0));
    const coreRingGeo = reg(new THREE.TorusGeometry(0.52, 0.035, 10, 24));
    const corePickupMat = reg(
      new THREE.MeshStandardMaterial({
        color: 0x5df0a8,
        emissive: 0x2fd38a,
        emissiveIntensity: 0.7,
        metalness: 0.3,
        roughness: 0.2,
      })
    );

    interface DataCore {
      group: THREE.Group;
      active: boolean;
      speed: number;
    }
    const dataCores: DataCore[] = Array.from({ length: 8 }, () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(corePickupGeo, corePickupMat));
      g.add(new THREE.Mesh(coreRingGeo, matGoldNose));
      g.visible = false;
      scene.add(g);
      return { group: g, active: false, speed: 12 };
    });

    // Pooled Explosion Particles (zero per-frame GC)
    const particleGeo = reg(new THREE.BoxGeometry(0.11, 0.11, 0.11));
    const particleMintMat = reg(new THREE.MeshBasicMaterial({ color: 0x5df0a8 }));
    const particleGoldMat = reg(new THREE.MeshBasicMaterial({ color: 0xfbbf24 }));

    interface Particle {
      mesh: THREE.Mesh;
      vel: THREE.Vector3;
      life: number;
      maxLife: number;
    }
    const particles: Particle[] = Array.from({ length: 70 }, (_, idx) => {
      const m = new THREE.Mesh(particleGeo, idx % 2 === 0 ? particleMintMat : particleGoldMat);
      m.visible = false;
      scene.add(m);
      return { mesh: m, vel: new THREE.Vector3(), life: 0, maxLife: 0.5 };
    });

    const spawnBurst = (pos: THREE.Vector3, count: number) => {
      let spawned = 0;
      for (let i = 0; i < particles.length && spawned < count; i++) {
        const p = particles[i];
        if (p.life <= 0) {
          p.mesh.position.copy(pos);
          p.vel.set(
            (Math.random() - 0.5) * 12,
            (Math.random() - 0.5) * 12,
            (Math.random() - 0.5) * 12
          );
          p.maxLife = 0.32 + Math.random() * 0.25;
          p.life = p.maxLife;
          p.mesh.scale.setScalar(1);
          p.mesh.visible = true;
          spawned++;
        }
      }
    };

    // -----------------------------------------------------------------------
    // Input State (`held` vs `justPressed`, cleared on window blur)
    // -----------------------------------------------------------------------
    const heldKeys = new Set<string>();
    const justPressed = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!heldKeys.has(e.code)) {
        justPressed.add(e.code);
      }
      heldKeys.add(e.code);

      if (e.code === 'KeyM') {
        toggleMute();
      }
      if ((e.code === 'Enter' || e.code === 'Space') && phaseRef.current === 'title') {
        triggerStartMission();
      } else if (e.code === 'Escape') {
        if (phaseRef.current === 'playing') {
          setPhase('paused');
        } else if (phaseRef.current === 'paused') {
          setPhase('playing');
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      heldKeys.delete(e.code);
    };

    const onBlur = () => {
      heldKeys.clear();
      justPressed.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    // -----------------------------------------------------------------------
    // Mutable Simulation State
    // -----------------------------------------------------------------------
    let shipX = 0;
    let shipY = 0;
    let fireCooldown = 0;
    let dashCooldown = 0;
    let invulnTimer = 0;
    let spawnTimer = 0.6;
    let coreSpawnTimer = 2.2;
    let hitstopTimer = 0;
    let shakeIntensity = 0;
    let currentScore = 0;
    let currentHull = 3;
    let currentWave = 1;

    const resetSimulation = () => {
      shipX = 0;
      shipY = 0;
      shipGroup.position.set(0, 0, 0);
      shipGroup.rotation.set(0, 0, 0);
      fireCooldown = 0;
      dashCooldown = 0;
      invulnTimer = 0;
      spawnTimer = 0.5;
      coreSpawnTimer = 2.0;
      hitstopTimer = 0;
      shakeIntensity = 0;
      currentScore = 0;
      currentHull = 3;
      currentWave = 1;

      bolts.forEach((b) => {
        b.active = false;
        b.mesh.visible = false;
      });
      hazards.forEach((h) => {
        h.active = false;
        h.group.visible = false;
      });
      dataCores.forEach((c) => {
        c.active = false;
        c.group.visible = false;
      });
      particles.forEach((p) => {
        p.life = 0;
        p.mesh.visible = false;
      });
    };

    const clock = new THREE.Clock();
    let rafId = 0;
    let isDisposed = false;

    const tick = () => {
      if (isDisposed) return;
      const rawDt = clock.getDelta();
      const dt = Math.min(rawDt, 0.05);

      if (commandQueueRef.current === 'start') {
        commandQueueRef.current = null;
        resetSimulation();
      }

      // Always gently rotate distant Earth & stars for living atmosphere
      earthHorizon.rotation.y += dt * 0.03;

      if (phaseRef.current === 'title') {
        shipGroup.position.set(Math.sin(clock.elapsedTime * 0.9) * 1.4, Math.cos(clock.elapsedTime * 1.3) * 0.35, 0);
        shipGroup.rotation.z = -Math.cos(clock.elapsedTime * 0.9) * 0.22;
        camera.position.lerp(baseCamPos, 1 - Math.exp(-5 * dt));
        renderer.render(scene, camera);
        justPressed.clear();
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      if (phaseRef.current !== 'playing') {
        renderer.render(scene, camera);
        justPressed.clear();
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      // Hitstop freeze-frame on heavy impacts
      if (hitstopTimer > 0) {
        hitstopTimer -= dt;
        renderer.render(scene, camera);
        justPressed.clear();
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      // Player Movement & Phase Dash
      let moveX = 0;
      let moveY = 0;
      if (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft')) moveX -= 1;
      if (heldKeys.has('KeyD') || heldKeys.has('ArrowRight')) moveX += 1;
      if (heldKeys.has('KeyW') || heldKeys.has('ArrowUp')) moveY += 1;
      if (heldKeys.has('KeyS') || heldKeys.has('ArrowDown')) moveY -= 1;

      dashCooldown = Math.max(0, dashCooldown - dt);
      invulnTimer = Math.max(0, invulnTimer - dt);

      let speedMult = 1;
      if ((justPressed.has('ShiftLeft') || justPressed.has('ShiftRight')) && dashCooldown <= 0) {
        dashCooldown = 1.35;
        invulnTimer = 0.28;
        speedMult = 3.2;
        sfx.playDash();
      }

      const moveSpeed = 10.5 * speedMult;
      shipX = THREE.MathUtils.clamp(shipX + moveX * moveSpeed * dt, -5.8, 5.8);
      shipY = THREE.MathUtils.clamp(shipY + moveY * 8.2 * dt, -1.2, 2.6);

      shipGroup.position.x = THREE.MathUtils.damp(shipGroup.position.x, shipX, 14, dt);
      shipGroup.position.y = THREE.MathUtils.damp(shipGroup.position.y, shipY, 14, dt);
      shipGroup.rotation.z = THREE.MathUtils.damp(shipGroup.rotation.z, -moveX * 0.42, 12, dt);
      shipGroup.rotation.x = THREE.MathUtils.damp(shipGroup.rotation.x, moveY * 0.18, 12, dt);
      shipGroup.visible = invulnTimer > 0 ? Math.floor(invulnTimer * 28) % 2 === 0 : true;

      // Pulse Laser Firing
      fireCooldown = Math.max(0, fireCooldown - dt);
      if ((heldKeys.has('Space') || justPressed.has('Space')) && fireCooldown <= 0) {
        fireCooldown = 0.16;
        for (let i = 0; i < bolts.length; i++) {
          if (!bolts[i].active) {
            bolts[i].active = true;
            bolts[i].mesh.position.set(shipGroup.position.x, shipGroup.position.y, -1.1);
            bolts[i].mesh.visible = true;
            sfx.playLaser();
            break;
          }
        }
      }

      // Update Bolts
      for (let i = 0; i < bolts.length; i++) {
        const b = bolts[i];
        if (!b.active) continue;
        b.mesh.position.z -= 54 * dt;
        if (b.mesh.position.z < -68) {
          b.active = false;
          b.mesh.visible = false;
        }
      }

      // Smooth Wave Progression (Wave 1 -> 2 -> 3)
      const computedWave = currentScore >= 900 ? 3 : currentScore >= 400 ? 2 : 1;
      if (computedWave !== currentWave) {
        currentWave = computedWave;
        setWave(computedWave);
      }

      // Spawn Hazard Drones with 0.42s Windup Telegraph
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = Math.max(0.38, 1.05 - currentWave * 0.2);
        for (let i = 0; i < hazards.length; i++) {
          const h = hazards[i];
          if (!h.active) {
            h.active = true;
            h.hp = currentWave >= 3 ? 3 : 2;
            h.windup = 0.42; // 420ms telegraph windup before launching forward
            h.speed = 14 + currentWave * 3.8 + Math.random() * 3.5;
            h.flashTimer = 0;
            h.spinSpeed = (Math.random() - 0.5) * 3.2;
            h.group.position.set(
              (Math.random() - 0.5) * 10.8,
              -0.9 + Math.random() * 3.2,
              -52
            );
            h.telegraph.visible = true;
            h.telegraph.scale.setScalar(1.8);
            h.coreMat.emissive.setHex(0xef4444);
            h.coreMat.emissiveIntensity = 0.25;
            h.group.visible = true;
            break;
          }
        }
      }

      // Spawn Telemetry Data Cores
      coreSpawnTimer -= dt;
      if (coreSpawnTimer <= 0) {
        coreSpawnTimer = 2.6;
        for (let i = 0; i < dataCores.length; i++) {
          const c = dataCores[i];
          if (!c.active) {
            c.active = true;
            c.speed = 13 + currentWave * 2;
            c.group.position.set(
              (Math.random() - 0.5) * 9.6,
              -0.7 + Math.random() * 2.8,
              -50
            );
            c.group.visible = true;
            break;
          }
        }
      }

      // Update Hazards & Collisions
      for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i];
        if (!h.active) continue;

        if (h.windup > 0) {
          h.windup -= dt;
          const s = 1 + h.windup * 2.2;
          h.telegraph.scale.setScalar(s);
          if (h.windup <= 0) {
            h.telegraph.visible = false;
          }
        } else {
          h.group.position.z += h.speed * dt;
        }

        h.group.rotation.z += h.spinSpeed * dt;
        h.group.rotation.y += dt * 0.9;

        if (h.flashTimer > 0) {
          h.flashTimer -= dt;
          if (h.flashTimer <= 0) {
            h.coreMat.emissive.setHex(0xef4444);
            h.coreMat.emissiveIntensity = 0.25;
          }
        }

        // Bolt vs Hazard Collision
        for (let bIdx = 0; bIdx < bolts.length; bIdx++) {
          const b = bolts[bIdx];
          if (!b.active) continue;
          if (b.mesh.position.distanceToSquared(h.group.position) < 1.15) {
            b.active = false;
            b.mesh.visible = false;
            h.hp -= 1;

            if (h.hp <= 0) {
              h.active = false;
              h.group.visible = false;
              spawnBurst(h.group.position, 14);
              sfx.playExplosion(true);
              hitstopTimer = 0.042;
              shakeIntensity = Math.min(0.45, shakeIntensity + 0.18);
              currentScore += 100;
              setScore(currentScore);

              if (currentScore >= VICTORY_SCORE) {
                shipGroup.visible = true;
                setPhase('victory');
                recordRunCompletion(currentScore, currentWave);
                return;
              }
            } else {
              // Hit flash confirmation
              h.flashTimer = 0.09;
              h.coreMat.emissive.setHex(0xffffff);
              h.coreMat.emissiveIntensity = 1.4;
              sfx.playExplosion(false);
            }
            break;
          }
        }

        // Ship vs Hazard Collision
        if (
          h.active &&
          invulnTimer <= 0 &&
          h.group.position.distanceToSquared(shipGroup.position) < 1.18
        ) {
          h.active = false;
          h.group.visible = false;
          spawnBurst(shipGroup.position, 18);
          sfx.playExplosion(true);
          shakeIntensity = 0.42;
          hitstopTimer = 0.055;
          invulnTimer = 1.25;
          currentHull -= 1;
          setHull(currentHull);

          if (currentHull <= 0) {
            shipGroup.visible = false;
            setPhase('gameover');
            recordRunCompletion(currentScore, currentWave);
            return;
          }
        }

        if (h.group.position.z > 8) {
          h.active = false;
          h.group.visible = false;
        }
      }

      // Update Collectible Telemetry Cores
      for (let i = 0; i < dataCores.length; i++) {
        const c = dataCores[i];
        if (!c.active) continue;
        c.group.position.z += c.speed * dt;
        c.group.rotation.y += dt * 2.4;
        c.group.rotation.x += dt * 1.2;

        if (c.group.position.distanceToSquared(shipGroup.position) < 1.35) {
          c.active = false;
          c.group.visible = false;
          spawnBurst(c.group.position, 10);
          sfx.playPickup();
          currentScore += 150;
          setScore(currentScore);

          if (currentScore >= VICTORY_SCORE) {
            shipGroup.visible = true;
            setPhase('victory');
            recordRunCompletion(currentScore, currentWave);
            return;
          }
        } else if (c.group.position.z > 8) {
          c.active = false;
          c.group.visible = false;
        }
      }

      // Update Particles
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.mesh.visible = false;
        } else {
          p.mesh.position.addScaledVector(p.vel, dt);
          p.mesh.scale.setScalar(Math.max(0.05, p.life / p.maxLife));
        }
      }

      // Decaying Camera Shake + Subtle Parallax Follow
      shakeIntensity = Math.max(0, shakeIntensity - dt * 1.6);
      const sx = (Math.random() - 0.5) * shakeIntensity;
      const sy = (Math.random() - 0.5) * shakeIntensity;
      camera.position.set(
        baseCamPos.x + shipGroup.position.x * 0.22 + sx,
        baseCamPos.y + shipGroup.position.y * 0.16 + sy,
        baseCamPos.z
      );
      camera.lookAt(shipGroup.position.x * 0.15, shipGroup.position.y * 0.1, -12);

      renderer.render(scene, camera);
      justPressed.clear();
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    const onResize = () => {
      if (isDisposed) return;
      camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('resize', onResize);
      sfx.dispose();
      disposables.forEach((d) => d.dispose());
      envRT.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [recordRunCompletion, toggleMute, triggerStartMission]);

  return (
    <div className="fixed inset-0 z-50 h-[100dvh] w-screen overflow-hidden bg-[#03050d] select-none">
      {/* Full-Viewport Isolated WebGL Canvas */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* ===================================================================
          MINIMAL CORNER HUD (Strictly >= 88% unobstructed playfield, no blur)
      ==================================================================== */}
      <div className="pointer-events-none absolute inset-x-0 top-0 p-5 sm:p-7 flex items-start justify-between gap-4">
        {phase !== 'title' ? (
          <div className="flex items-center gap-6 text-xs sm:text-sm font-mono-tabular">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#6b7796]">Score</div>
              <div className="text-lg sm:text-2xl font-bold text-[#f3f6ff]">
                {score.toString().padStart(4, '0')}{' '}
                <span className="text-xs font-normal text-[#6b7796]">/ {VICTORY_SCORE}</span>
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#6b7796]">Wave</div>
              <div className="text-lg sm:text-2xl font-bold text-[#5df0a8]">0{wave}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wider text-[#6b7796]">Hull Integrity</div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {[0, 1, 2].map((idx) => (
                  <span
                    key={idx}
                    className={`h-2.5 w-6 rounded-sm ${
                      idx < hull ? 'bg-[#5df0a8]' : 'bg-[#1b2540]'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div />
        )}

        {/* Interactive Utility Controls */}
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            className="p-2.5 rounded-xl bg-[#090f24] border border-[#96afe6]/22 text-[#9aa6c4] hover:text-[#f3f6ff] cursor-pointer"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-[#5df0a8]" />}
          </button>

          {phase === 'playing' && (
            <button
              type="button"
              onClick={() => setPhase('paused')}
              aria-label="Pause simulation"
              className="p-2.5 rounded-xl bg-[#090f24] border border-[#96afe6]/22 text-[#9aa6c4] hover:text-[#f3f6ff] cursor-pointer"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onExitGame}
            className="px-3.5 py-2 rounded-xl bg-[#090f24] border border-[#96afe6]/22 text-xs font-semibold text-[#f3f6ff] hover:border-[#5df0a8]/50 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#5df0a8]" />
            <span>Exit to Workspace</span>
          </button>
        </div>
      </div>

      {/* ===================================================================
          STATE 1: BESPOKE SVG TITLE LOCKUP OVER OPEN NEGATIVE SPACE
      ==================================================================== */}
      {phase === 'title' && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between py-14 px-6 text-center">
          <div />

          {/* Floating Custom Vector SVG Lockup (No Heavy Modal Box) */}
          <div className="flex flex-col items-center max-w-xl">
            <svg
              viewBox="0 0 360 88"
              className="w-64 sm:w-80 h-auto mb-3 overflow-visible"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="kvGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#7efad8" />
                  <stop offset="50%" stopColor="#5df0a8" />
                  <stop offset="100%" stopColor="#2fd38a" />
                </linearGradient>
              </defs>
              {/* Orbital Vector Emblem */}
              <ellipse
                cx="180"
                cy="44"
                rx="148"
                ry="26"
                fill="none"
                stroke="#5df0a8"
                strokeOpacity="0.28"
                strokeWidth="1.2"
                transform="rotate(-8 180 44)"
              />
              <polygon points="180,10 194,38 180,31 166,38" fill="url(#kvGrad)" />
              <text
                x="180"
                y="68"
                textAnchor="middle"
                fill="#f3f6ff"
                fontSize="26"
                fontWeight="800"
                letterSpacing="5"
              >
                KESSLER VECTOR
              </text>
            </svg>

            <p className="text-xs sm:text-sm text-[#9aa6c4] max-w-md leading-relaxed">
              Clear rogue orbital debris and harvest telemetry cores to reach{' '}
              <span className="font-mono-tabular text-[#5df0a8] font-semibold">
                {VICTORY_SCORE} PTS
              </span>
              .
              {bestLocal > 0 && (
                <span className="ml-2 font-mono-tabular text-[#f3f6ff]">
                  · Personal Best: {bestLocal}
                </span>
              )}
            </p>

            <div className="pointer-events-auto mt-7 flex items-center gap-4">
              <button
                type="button"
                onClick={triggerStartMission}
                className="mint-btn-primary px-8 py-3.5 rounded-full text-sm font-bold tracking-wide flex items-center gap-2 whitespace-nowrap cursor-pointer shadow-xl"
              >
                <Play className="w-4 h-4 fill-[#032018]" />
                <span>LAUNCH MISSION</span>
              </button>
            </div>

            {leaderboard.length > 0 && (
              <div className="mt-8 text-xs text-[#9aa6c4] flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
                <span className="text-[#5df0a8] font-semibold">Top Pilots:</span>
                {leaderboard.slice(0, 3).map((entry, idx) => (
                  <span key={entry.id} className="font-mono-tabular">
                    #{idx + 1} {entry.pilotName} ({entry.score})
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Single Flat Control-Hint Line */}
          <p className="text-xs font-mono-tabular text-[#9aa6c4] tracking-wide">
            WASD / Arrows Steer · Space Pulse Cannon · Shift Phase Dash · Esc Pause
          </p>
        </div>
      )}

      {/* ===================================================================
          STATES 3/4/5: PAUSE / VICTORY / GAME OVER MODAL
      ==================================================================== */}
      {(phase === 'paused' || phase === 'victory' || phase === 'gameover') && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#03050d]/80 p-5">
          <div className="w-full max-w-md rounded-2xl border border-[#96afe6]/24 bg-[#090f24] p-7 text-center flex flex-col gap-5">
            <div>
              <p className="text-xs font-mono-tabular uppercase tracking-widest text-[#5df0a8]">
                {phase === 'paused'
                  ? 'Simulation Paused'
                  : phase === 'victory'
                    ? 'Orbital Corridor Cleared'
                    : 'Hull Integrity Depleted'}
              </p>
              <h2 className="mt-1 text-2xl font-extrabold text-[#f3f6ff]">
                {phase === 'paused'
                  ? 'Flight Hold Active'
                  : phase === 'victory'
                    ? 'Mission Accomplished'
                    : 'Telemetry Link Lost'}
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-3 py-3 border-y border-[#96afe6]/14 font-mono-tabular">
              <div>
                <div className="text-xs text-[#6b7796]">Final Score</div>
                <div className="text-xl font-bold text-[#f3f6ff]">{score}</div>
              </div>
              <div>
                <div className="text-xs text-[#6b7796]">Orbital Wave</div>
                <div className="text-xl font-bold text-[#5df0a8]">0{wave}</div>
              </div>
            </div>

            {leaderboard.length > 0 && phase !== 'paused' && (
              <div className="text-left flex flex-col gap-1.5">
                <div className="text-xs font-semibold text-[#9aa6c4]">
                  Cloud Pilot Leaderboard
                </div>
                {leaderboard.slice(0, 4).map((entry, idx) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between text-xs font-mono-tabular text-[#dbe4ff]"
                  >
                    <span>
                      {idx + 1}. {entry.pilotName}
                    </span>
                    <span className="text-[#5df0a8]">{entry.score} pts</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              {phase === 'paused' ? (
                <button
                  type="button"
                  onClick={() => setPhase('playing')}
                  className="mint-btn-primary px-6 py-2.5 rounded-full text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-[#032018]" />
                  <span>Resume Flight</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={triggerStartMission}
                  className="mint-btn-primary px-6 py-2.5 rounded-full text-xs sm:text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Fly Again</span>
                </button>
              )}

              <button
                type="button"
                onClick={onExitGame}
                className="px-5 py-2.5 rounded-full border border-[#96afe6]/24 bg-[#0e1736] text-xs sm:text-sm font-medium text-[#f3f6ff] cursor-pointer"
              >
                Return to Ascend
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
