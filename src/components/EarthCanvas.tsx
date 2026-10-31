import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Pre-allocated math helpers outside render loop (zero per-frame GC)
const _dummyObj = new THREE.Object3D();
const _normalVec = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

const KEYFRAME_STOPS = [0, 0.32, 0.64, 1.0];
const KEYFRAME_X = [0, -3.1, 3.2, 0];
const KEYFRAME_Y = [-4.5, 0.55, 0.45, 0.15];
const KEYFRAME_SCALE = [2.15, 1.0, 0.92, 1.12];

function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function samplePiecewiseSmooth(progress: number, stops: number[], values: number[]): number {
  const p = Math.max(0, Math.min(1, progress));
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (p <= s1 || i === stops.length - 2) {
      const localT = s1 > s0 ? (p - s0) / (s1 - s0) : 0;
      const eased = smoothstep01(localT);
      return values[i] + (values[i + 1] - values[i]) * eased;
    }
  }
  return values[values.length - 1];
}

const GLSL_NOISE_3D = `
  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);

    return mix(
      mix(
        mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x),
        f.y
      ),
      mix(
        mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x),
        f.y
      ),
      f.z
    );
  }

  float fbm5(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    mat3 rot = mat3(
      0.00,  0.80,  0.60,
     -0.80,  0.36, -0.48,
     -0.60, -0.48,  0.64
    );
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = rot * p * 2.04 + vec3(1.7, 9.2, 4.3);
      a *= 0.5;
    }
    return v;
  }
`;

export default function EarthCanvas() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = reducedMotionQuery.matches;

    // Detect software WebGL from GPU renderer string
    const isSoftwareGl = (() => {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
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
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.domElement.className = 'block w-full h-full';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x04060f, 0.025);

    const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
    camera.position.set(0, 0.15, 7.6);

    // Studio environment map for metallic orbital rings & PBR components
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    // Balanced warm solar key + cool deep-space hemisphere fill
    const sunDir = new THREE.Vector3(4.8, 2.3, 4.1).normalize();
    const keyLight = new THREE.DirectionalLight(0xfff1dc, 2.2);
    keyLight.position.copy(sunDir).multiplyScalar(12);
    scene.add(keyLight);

    const hemiLight = new THREE.HemisphereLight(0x5da9ff, 0x050918, 0.75);
    scene.add(hemiLight);

    const rimLight = new THREE.DirectionalLight(0x5df0a8, 0.65);
    rimLight.position.set(-6, 3, -5);
    scene.add(rimLight);

    // -----------------------------------------------------------------------
    // 1. Twinkling Starfield (1,400 points)
    // -----------------------------------------------------------------------
    const starCount = 1400;
    const starPositions = new Float32Array(starCount * 3);
    const starSeeds = new Float32Array(starCount);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const r = 18 + Math.random() * 44;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = -Math.abs(r * Math.cos(phi)) - 4;
      starSeeds[i] = Math.random() * 100;

      const paletteRoll = Math.random();
      if (paletteRoll < 0.6) {
        starColors[i * 3] = 0.88;
        starColors[i * 3 + 1] = 0.93;
        starColors[i * 3 + 2] = 1.0;
      } else if (paletteRoll < 0.85) {
        starColors[i * 3] = 0.68;
        starColors[i * 3 + 1] = 0.84;
        starColors[i * 3 + 2] = 1.0;
      } else {
        starColors[i * 3] = 1.0;
        starColors[i * 3 + 1] = 0.91;
        starColors[i * 3 + 2] = 0.74;
      }
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeo.setAttribute('aSeed', new THREE.BufferAttribute(starSeeds, 1));
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(starColors, 3));

    const starMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: isSoftwareGl ? 1.0 : Math.min(window.devicePixelRatio || 1, 2) },
      },
      vertexShader: `
        attribute float aSeed;
        attribute vec3 aColor;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          vColor = aColor;
          float twinkle = 0.62 + 0.38 * sin(uTime * (0.9 + fract(aSeed) * 1.6) + aSeed * 6.2831);
          vAlpha = twinkle;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          float baseSize = 1.4 + fract(aSeed * 3.17) * 2.2;
          gl_PointSize = baseSize * uPixelRatio * (22.0 / max(8.0, -mvPos.z));
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying vec3 vColor;

        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float d = length(c);
          float mask = smoothstep(0.5, 0.08, d);
          if (mask < 0.01) discard;
          gl_FragColor = vec4(vColor, mask * vAlpha * 0.92);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const starPoints = new THREE.Points(starGeo, starMat);
    starPoints.frustumCulled = false;
    scene.add(starPoints);

    // -----------------------------------------------------------------------
    // 2. Composite Multi-Part Earth Assembly (`THREE.Group`)
    // -----------------------------------------------------------------------
    const planetRoot = new THREE.Group();
    scene.add(planetRoot);

    const earthAxialGroup = new THREE.Group();
    earthAxialGroup.rotation.z = THREE.MathUtils.degToRad(23.4);
    planetRoot.add(earthAxialGroup);

    const earthRadius = 1.72;

    // Part A: Procedurally Shaded Earth Core (FBM Continents, Ocean Glint, City Lights, Blue Rim)
    const earthGeo = new THREE.SphereGeometry(earthRadius, 96, 96);
    const earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone() },
      },
      vertexShader: `
        varying vec3 vObjNormal;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;

        void main() {
          vObjNormal = normalize(position);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec3 vObjNormal;
        varying vec3 vWorldNormal;
        varying vec3 vWorldPos;

        ${GLSL_NOISE_3D}

        void main() {
          vec3 p = normalize(vObjNormal);
          // Multi-scale FBM continent mask with subtle domain warp
          vec3 warp = vec3(
            fbm5(p * 2.1 + vec3(0.4, 1.2, 2.5)),
            fbm5(p * 2.1 + vec3(3.1, 0.7, 1.4)),
            fbm5(p * 2.1 + vec3(1.9, 4.2, 0.6))
          );
          float elevation = fbm5(p * 2.45 + warp * 0.48);
          float fineDetail = fbm5(p * 11.5 + warp * 0.9);
          float h = elevation * 0.84 + fineDetail * 0.16;

          float seaLevel = 0.505;
          float landMask = smoothstep(seaLevel - 0.016, seaLevel + 0.022, h);
          float coastShelf = smoothstep(seaLevel - 0.065, seaLevel, h) * (1.0 - landMask);

          // Polar latitude factor
          float lat = abs(p.y);
          float iceCap = smoothstep(0.76, 0.90, lat + (fineDetail - 0.5) * 0.12);

          // Ocean bathymetry colors
          vec3 deepOcean = vec3(0.018, 0.058, 0.165);
          vec3 shallowOcean = vec3(0.045, 0.215, 0.365);
          vec3 oceanCol = mix(deepOcean, shallowOcean, coastShelf);

          // Continental biomes
          vec3 lushLand = vec3(0.065, 0.225, 0.155);
          vec3 aridLand = vec3(0.245, 0.205, 0.145);
          vec3 highland = vec3(0.185, 0.205, 0.235);
          float aridity = smoothstep(0.42, 0.72, fbm5(p * 4.2 + vec3(5.2)));
          vec3 landCol = mix(lushLand, aridLand, aridity * (1.0 - smoothstep(0.45, 0.75, lat)));
          landCol = mix(landCol, highland, smoothstep(0.62, 0.76, h));

          vec3 surfaceAlbedo = mix(oceanCol, landCol, landMask);
          surfaceAlbedo = mix(surfaceAlbedo, vec3(0.82, 0.89, 0.96), iceCap);

          // Illumination & terminator
          vec3 N = normalize(vWorldNormal);
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 L = normalize(uSunDir);

          float ndotl = dot(N, L);
          float dayFactor = smoothstep(-0.14, 0.24, ndotl);
          float diffuse = max(0.0, ndotl);

          // Solar ocean specular glint
          vec3 H = normalize(L + V);
          float oceanRipples = 0.82 + 0.18 * fineDetail;
          float spec = pow(max(0.0, dot(N, H)), 54.0) * (1.0 - landMask) * (1.0 - iceCap) * oceanRipples;
          vec3 glintColor = vec3(0.62, 0.84, 1.0) * spec * 0.85 * smoothstep(-0.02, 0.2, ndotl);

          // Night-side golden city light clusters on continents
          float cityCluster = fbm5(p * 18.0 + vec3(2.4, 7.1, 3.8));
          float citySpark = smoothstep(0.59, 0.74, cityCluster) * smoothstep(0.48, 0.82, fineDetail * 1.25);
          float temperateBand = 1.0 - smoothstep(0.58, 0.78, lat);
          float nightMask = smoothstep(0.14, -0.22, ndotl);
          vec3 cityLights = vec3(1.0, 0.76, 0.36) * citySpark * landMask * temperateBand * nightMask * 1.55;

          // Ambient night blue earthshine + sunlit day
          vec3 nightAmbient = surfaceAlbedo * vec3(0.09, 0.14, 0.28);
          vec3 dayLit = surfaceAlbedo * (0.14 + 1.18 * diffuse);
          vec3 color = mix(nightAmbient, dayLit, dayFactor) + glintColor + cityLights;

          // Atmospheric Rayleigh blue-mint rim light
          float fresnel = pow(1.0 - max(0.0, dot(V, N)), 3.4);
          vec3 rimHue = mix(vec3(0.18, 0.52, 0.98), vec3(0.36, 0.94, 0.66), 0.25);
          color += rimHue * fresnel * (0.35 + 0.65 * smoothstep(-0.45, 0.55, ndotl));

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    earthAxialGroup.add(earthMesh);

    // Part B: Drifting Cloud Shell 1 (Troposphere Cumulus)
    const cloudGeo1 = new THREE.SphereGeometry(earthRadius * 1.015, 72, 72);
    const cloudMat1 = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone() },
      },
      vertexShader: `
        varying vec3 vObjPos;
        varying vec3 vWorldNormal;
        void main() {
          vObjPos = normalize(position);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec3 vObjPos;
        varying vec3 vWorldNormal;
        ${GLSL_NOISE_3D}

        void main() {
          vec3 p = vObjPos;
          float swirl = fbm5(p * 3.2 + vec3(uTime * 0.012, 0.0, -uTime * 0.008));
          float wisps = fbm5(p * 6.8 + vec3(swirl * 1.15 - uTime * 0.015));
          float density = smoothstep(0.53, 0.76, wisps);
          float ndotl = dot(normalize(vWorldNormal), normalize(uSunDir));
          float lit = smoothstep(-0.22, 0.35, ndotl);
          vec3 col = mix(vec3(0.09, 0.16, 0.32), vec3(0.94, 0.97, 1.0), lit);
          gl_FragColor = vec4(col, density * 0.42);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const cloudShell1 = new THREE.Mesh(cloudGeo1, cloudMat1);
    cloudShell1.renderOrder = 2;
    earthAxialGroup.add(cloudShell1);

    // Part C: Drifting Cloud Shell 2 (High-Altitude Cirrus Bands)
    const cloudGeo2 = new THREE.SphereGeometry(earthRadius * 1.028, 64, 64);
    const cloudMat2 = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: sunDir.clone() },
      },
      vertexShader: `
        varying vec3 vObjPos;
        varying vec3 vWorldNormal;
        void main() {
          vObjPos = normalize(position);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform vec3 uSunDir;
        varying vec3 vObjPos;
        varying vec3 vWorldNormal;
        ${GLSL_NOISE_3D}

        void main() {
          vec3 stretched = vec3(vObjPos.x * 2.2, vObjPos.y * 5.2, vObjPos.z * 2.2);
          float bands = fbm5(stretched + vec3(-uTime * 0.02, 1.3, uTime * 0.014));
          float density = smoothstep(0.58, 0.80, bands);
          float ndotl = dot(normalize(vWorldNormal), normalize(uSunDir));
          float lit = smoothstep(-0.2, 0.4, ndotl);
          vec3 col = mix(vec3(0.11, 0.21, 0.40), vec3(0.86, 0.94, 1.0), lit);
          gl_FragColor = vec4(col, density * 0.24);
        }
      `,
      transparent: true,
      depthWrite: false,
    });
    const cloudShell2 = new THREE.Mesh(cloudGeo2, cloudMat2);
    cloudShell2.renderOrder = 3;
    earthAxialGroup.add(cloudShell2);

    // Part D: Additive Blue Atmosphere Halo Corona
    const haloGeo = new THREE.SphereGeometry(earthRadius * 1.19, 64, 64);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: sunDir.clone() },
      },
      vertexShader: `
        varying vec3 vNormalView;
        varying vec3 vWorldNormal;
        varying vec3 vViewPos;
        void main() {
          vNormalView = normalize(normalMatrix * normal);
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewPos = mvPos.xyz;
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uSunDir;
        varying vec3 vNormalView;
        varying vec3 vWorldNormal;
        varying vec3 vViewPos;

        void main() {
          vec3 viewDir = normalize(-vViewPos);
          // BackSide normal faces inward; dot(-vNormalView, viewDir) peaks near center and drops to 0 at outer edge
          float edge = max(0.0, dot(-vNormalView, viewDir));
          float intensity = pow(edge, 2.4) * smoothstep(0.0, 0.55, 1.0 - edge) * 2.1;
          float sunSide = 0.45 + 0.55 * smoothstep(-0.5, 0.6, dot(vWorldNormal, normalize(uSunDir)));
          vec3 glowCol = mix(vec3(0.14, 0.44, 0.96), vec3(0.36, 0.94, 0.66), 0.22);
          gl_FragColor = vec4(glowCol * intensity * sunSide, intensity * 0.72);
        }
      `,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const haloMesh = new THREE.Mesh(haloGeo, haloMat);
    haloMesh.renderOrder = 1;
    planetRoot.add(haloMesh);

    // Part E: 60 Golden Radar-Ping Research Markers (`THREE.InstancedMesh`)
    const pingCount = 60;
    const pingGeo = new THREE.RingGeometry(0.011, 0.026, 20);
    pingGeo.rotateX(-Math.PI / 2);

    const pingPhases = new Float32Array(pingCount);
    const pingMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        attribute float aPhase;
        uniform float uTime;
        varying float vPulse;

        void main() {
          float wave = fract(uTime * 0.42 + aPhase);
          float scale = 0.75 + wave * 1.65;
          vPulse = (1.0 - wave) * smoothstep(0.0, 0.18, wave);
          vec3 scaledPos = position * scale;
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(scaledPos, 1.0);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying float vPulse;
        void main() {
          vec3 gold = mix(vec3(1.0, 0.78, 0.28), vec3(0.36, 0.94, 0.66), 0.22);
          gl_FragColor = vec4(gold, vPulse * 0.88);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    pingGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(pingPhases, 1));
    const pingMesh = new THREE.InstancedMesh(pingGeo, pingMat, pingCount);

    // Golden-angle Fibonacci distribution biased toward mid-latitudes (global research hubs)
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < pingCount; i++) {
      const y = ((i / (pingCount - 1)) * 2 - 1) * 0.72; // avoid extreme poles
      const radiusAtY = Math.sqrt(Math.max(0.001, 1 - y * y));
      const theta = goldenAngle * i * 3.7;
      _normalVec.set(Math.cos(theta) * radiusAtY, y, Math.sin(theta) * radiusAtY).normalize();

      _dummyObj.position.copy(_normalVec).multiplyScalar(earthRadius * 1.006);
      _quat.setFromUnitVectors(_upVec, _normalVec);
      _dummyObj.quaternion.copy(_quat);
      const s = 0.85 + (i % 5) * 0.08;
      _dummyObj.scale.set(s, s, s);
      _dummyObj.updateMatrix();
      pingMesh.setMatrixAt(i, _dummyObj.matrix);
      pingPhases[i] = (i * 0.6180339) % 1;
    }
    pingMesh.instanceMatrix.needsUpdate = true;
    pingMesh.computeBoundingSphere();
    pingMesh.renderOrder = 4;
    earthAxialGroup.add(pingMesh);

    // Part F & G: Dual Precision Orbital Telemetry Rings (Varied Roughness/Metalness PBR)
    const primaryOrbitGeo = new THREE.TorusGeometry(earthRadius * 1.36, 0.0045, 12, 160);
    const primaryOrbitMat = new THREE.MeshStandardMaterial({
      color: 0x7aaeff,
      metalness: 0.88,
      roughness: 0.18,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const primaryOrbitMesh = new THREE.Mesh(primaryOrbitGeo, primaryOrbitMat);
    primaryOrbitMesh.rotation.x = Math.PI * 0.42;
    primaryOrbitMesh.rotation.y = Math.PI * 0.12;
    planetRoot.add(primaryOrbitMesh);

    const secondaryOrbitGeo = new THREE.TorusGeometry(earthRadius * 1.26, 0.0032, 10, 140);
    const secondaryOrbitMat = new THREE.MeshStandardMaterial({
      color: 0x5df0a8,
      metalness: 0.55,
      roughness: 0.46,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const secondaryOrbitMesh = new THREE.Mesh(secondaryOrbitGeo, secondaryOrbitMat);
    secondaryOrbitMesh.rotation.x = -Math.PI * 0.34;
    secondaryOrbitMesh.rotation.z = Math.PI * 0.22;
    planetRoot.add(secondaryOrbitMesh);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // -----------------------------------------------------------------------
    // 3. Scroll Choreography & Entrance State
    // -----------------------------------------------------------------------
    const getScrollProgress = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      return Math.max(0, Math.min(1, window.scrollY / maxScroll));
    };

    const initialScroll = getScrollProgress();
    const xAspectMultiplier = () => {
      const w = window.innerWidth;
      if (w < 560) return 0.26;
      if (w < 820) return 0.52;
      if (w < 1100) return 0.78;
      return 1.0;
    };

    let currentX = samplePiecewiseSmooth(initialScroll, KEYFRAME_STOPS, KEYFRAME_X) * xAspectMultiplier();
    let currentY = prefersReducedMotion
      ? samplePiecewiseSmooth(initialScroll, KEYFRAME_STOPS, KEYFRAME_Y)
      : -6.5;
    let currentScale = samplePiecewiseSmooth(initialScroll, KEYFRAME_STOPS, KEYFRAME_SCALE);
    let currentScrollRot = initialScroll * Math.PI * 1.85;

    planetRoot.position.set(currentX, currentY, 0);
    planetRoot.scale.setScalar(currentScale);

    const clock = new THREE.Clock();
    const entranceDuration = 1.9;
    let elapsedTotal = 0;
    let frameId = 0;
    let isDisposed = false;
    let contextLost = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext | null;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (isDisposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function updateSceneState(dt: number) {
      const clampedDt = Math.min(dt, 0.08);
      elapsedTotal += clampedDt;

      const progress = getScrollProgress();
      const mult = xAspectMultiplier();

      const targetX = samplePiecewiseSmooth(progress, KEYFRAME_STOPS, KEYFRAME_X) * mult;
      const keyframeY = samplePiecewiseSmooth(progress, KEYFRAME_STOPS, KEYFRAME_Y);
      const targetScale = samplePiecewiseSmooth(progress, KEYFRAME_STOPS, KEYFRAME_SCALE);
      const targetScrollRot = progress * Math.PI * 1.85;

      // One-time float-up entrance from y = -6.5 over 1.9s
      let targetY = keyframeY;
      if (!prefersReducedMotion && elapsedTotal < entranceDuration) {
        const t = Math.min(1, elapsedTotal / entranceDuration);
        const easeOut = 1 - Math.pow(1 - t, 3);
        targetY = -6.5 + (keyframeY - -6.5) * easeOut;
      }

      if (prefersReducedMotion) {
        currentX = targetX;
        currentY = keyframeY;
        currentScale = targetScale;
        currentScrollRot = targetScrollRot;
      } else {
        const lambda = 6.2;
        currentX = THREE.MathUtils.damp(currentX, targetX, lambda, clampedDt);
        currentY = THREE.MathUtils.damp(currentY, targetY, lambda, clampedDt);
        currentScale = THREE.MathUtils.damp(currentScale, targetScale, lambda, clampedDt);
        currentScrollRot = THREE.MathUtils.damp(currentScrollRot, targetScrollRot, lambda, clampedDt);
      }

      planetRoot.position.set(currentX, currentY, 0);
      planetRoot.scale.setScalar(currentScale);

      const spinTime = prefersReducedMotion ? 0 : elapsedTotal;
      earthMesh.rotation.y = 0.65 + spinTime * 0.055 + currentScrollRot;
      cloudShell1.rotation.y = 0.65 + spinTime * 0.072 + currentScrollRot * 1.06;
      cloudShell2.rotation.y = 0.9 + spinTime * 0.044 + currentScrollRot * 0.96;
      pingMesh.rotation.y = earthMesh.rotation.y;

      primaryOrbitMesh.rotation.z = spinTime * 0.03 + currentScrollRot * 0.25;
      secondaryOrbitMesh.rotation.y = -spinTime * 0.025 - currentScrollRot * 0.18;

      earthMat.uniforms.uTime.value = spinTime;
      cloudMat1.uniforms.uTime.value = spinTime;
      cloudMat2.uniforms.uTime.value = spinTime;
      pingMat.uniforms.uTime.value = spinTime;
      starMat.uniforms.uTime.value = spinTime;
    }

    function tick() {
      if (isDisposed || contextLost) return;
      const dt = clock.getDelta();
      updateSceneState(dt);
      renderer.render(scene, camera);

      if (prefersReducedMotion) return; // Render on-demand via scroll/resize listeners when reduced motion is active
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = window.requestAnimationFrame(tick);
      }
    }

    let renderQueued = false;
    function requestStaticRender() {
      if (!prefersReducedMotion || renderQueued || isDisposed || contextLost) return;
      renderQueued = true;
      window.requestAnimationFrame(() => {
        renderQueued = false;
        if (isDisposed || contextLost) return;
        updateSceneState(0.016);
        renderer.render(scene, camera);
      });
    }

    const handleResize = () => {
      if (isDisposed) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (prefersReducedMotion) requestStaticRender();
    };

    const handleScroll = () => {
      if (prefersReducedMotion) requestStaticRender();
    };

    const handleReducedMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      if (prefersReducedMotion) {
        requestStaticRender();
      } else {
        clock.getDelta();
        tick();
      }
    };

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
    };

    const handleContextRestored = () => {
      contextLost = false;
      clock.getDelta();
      tick();
    };

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('scroll', handleScroll, { passive: true });
    reducedMotionQuery.addEventListener('change', handleReducedMotionChange);
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    // Kick off initial draw / loop
    tick();

    return () => {
      isDisposed = true;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll);
      reducedMotionQuery.removeEventListener('change', handleReducedMotionChange);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      starGeo.dispose();
      starMat.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      cloudGeo1.dispose();
      cloudMat1.dispose();
      cloudGeo2.dispose();
      cloudMat2.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      pingGeo.dispose();
      pingMat.dispose();
      primaryOrbitGeo.dispose();
      primaryOrbitMat.dispose();
      secondaryOrbitGeo.dispose();
      secondaryOrbitMat.dispose();
      envTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse 85% 65% at 50% 92%, rgba(28, 72, 165, 0.22) 0%, rgba(9, 16, 40, 0.55) 46%, #04060f 100%)',
      }}
    >
      <div ref={mountRef} className="w-full h-full" />
    </div>
  );
}
