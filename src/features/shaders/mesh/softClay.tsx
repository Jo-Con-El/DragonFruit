import React from 'react';
import * as THREE from 'three';
import { blendTintColor, clampTintStrength } from './tint';

// Maximum number of support-coverage tips the shader can render at once.
// Each tip is one vec4 (xyz = world-space contact pos, w = halo radius).
// WebGL has a global vec4 uniform limit (typically 256+); 64 is far below
// that and covers the vast majority of resin-print support counts.
const MAX_SUPPORT_TIPS = 64;
const MAX_ISLAND_MARKERS = 16;

// Shader version — bump whenever onBeforeCompile body changes so the
// `customProgramCacheKey` returns a new value and Three.js recompiles
// instead of reusing the cached program from an earlier HMR cycle.
const SOFTCLAY_SHADER_VERSION = 'support-coverage-v9-islands-overhang-column';

export interface SupportCoverageTipData {
  // Flat Float32Array of length MAX_SUPPORT_TIPS * 4, in xyzr quartets.
  // We pre-pack on the CPU rather than uploading an array of Vector4
  // objects on every state change — keeps the uniform update branchless
  // and stable across React render passes.
  tips: Float32Array;
  count: number;
}

export interface IslandMarkerData {
  // MAX_ISLAND_MARKERS * 4 floats, xyzw = (centerX, centerY, baseZ, weight).
  // weight==0 → skipped (used to encode debug markers).
  markers: Float32Array;
  count: number;
}

export function SoftClayMaterial({
  isSelected,
  isHovered,
  useVertexColors,
  meshColor,
  hoverTintColor,
  selectedTintColor,
  hoverTintStrength,
  selectedTintStrength,
  materialRoughness,
  clippingPlanes,
  supportCoverageTips,
  supportCoverageColor,
  supportCoverageIntensity = 0.7,
  islandMarkers,
  showIslands = true,
  islandColor = '#FF6B00',
  islandIntensity = 0.85,
  islandRadiusFactor = 3.0,
  islandColumnHeight = 6.0,
  showOverhang = true,
  overhangColor = '#FF1744',
  overhangAngleDeg = 45,
  overhangIntensity = 0.7,
  overhangProximityMm = 8.0,
}: {
  isSelected: boolean;
  isHovered: boolean;
  useVertexColors?: boolean;
  meshColor?: string;
  hoverTintColor?: string;
  selectedTintColor?: string;
  hoverTintStrength?: number;
  selectedTintStrength?: number;
  materialRoughness?: number;
  clippingPlanes: THREE.Plane[];
  // When provided AND count > 0, the shader's fragment stage blends
  // toward supportCoverageColor for any fragment whose world position is
  // within the per-tip radius. Computed pixel-by-pixel, so the gradient
  // edge is buttery smooth and never follows mesh triangulation.
  supportCoverageTips?: SupportCoverageTipData;
  supportCoverageColor?: string;
  supportCoverageIntensity?: number;
  // Island highlight uniforms — paint a vertical column rising from
  // each marker's baseZ, radius = weight * islandRadiusFactor (mm).
  islandMarkers?: IslandMarkerData;
  showIslands?: boolean;
  islandColor?: string;
  islandIntensity?: number;
  islandRadiusFactor?: number;
  islandColumnHeight?: number;
  // Overhang highlight uniforms — paints fragments where the world-
  // space normal points downward past the threshold AND the fragment
  // is within overhangProximityMm of an island marker (combined
  // criterion: only the problem zones, not cosmetic overhangs).
  showOverhang?: boolean;
  overhangColor?: string;
  overhangAngleDeg?: number;
  overhangIntensity?: number;
  overhangProximityMm?: number;
}) {
  const baseColor = meshColor ?? '#a3a3a3';
  const selectedStrength = clampTintStrength(selectedTintStrength, 0.75);
  const hoverStrength = clampTintStrength(hoverTintStrength, 0.5);
  const tintColor = isSelected
    ? blendTintColor(baseColor, selectedTintColor, selectedStrength)
    : isHovered
      ? blendTintColor(baseColor, hoverTintColor, hoverStrength)
      : baseColor;

  const AO_STRENGTH = 0.2;
  const FAKE_LIGHT_DIRECTION = new THREE.Vector3(0.35, 0.58, 0.74).normalize();

  // Uniforms held in a ref so their .value references stay stable across
  // React re-renders. The compiled GLSL program binds these once at
  // compile time; mutating .value (or .value's contents) every frame is
  // what reaches the GPU.
  const uniformsRef = React.useRef({
    uFakeAoStrength: { value: AO_STRENGTH },
    uFakeLightDir: { value: FAKE_LIGHT_DIRECTION.clone() },
    uSupportTips: {
      value: new Float32Array(MAX_SUPPORT_TIPS * 4),
    },
    uSupportTipCount: { value: 0 },
    uSupportCoverageColor: {
      value: new THREE.Color(supportCoverageColor ?? '#00ff00'),
    },
    uSupportCoverageIntensity: { value: supportCoverageIntensity },

    uIslandMarkers: { value: new Float32Array(MAX_ISLAND_MARKERS * 4) },
    uIslandMarkerCount: { value: 0 },
    uShowIslands: { value: showIslands ? 1 : 0 },
    uIslandColor: { value: new THREE.Color(islandColor) },
    uIslandIntensity: { value: islandIntensity },
    uIslandRadiusFactor: { value: islandRadiusFactor },
    uIslandColumnHeight: { value: islandColumnHeight },

    uShowOverhang: { value: showOverhang ? 1 : 0 },
    uOverhangColor: { value: new THREE.Color(overhangColor) },
    uOverhangCosThreshold: { value: Math.cos((overhangAngleDeg * Math.PI) / 180) },
    uOverhangIntensity: { value: overhangIntensity },
    uOverhangProximityMm: { value: overhangProximityMm },
  });

  // Live-sync support-coverage uniforms whenever the source data changes.
  // We copy into the existing Float32Array rather than reassigning so the
  // shader's bound uniform location keeps pointing at the same buffer.
  React.useEffect(() => {
    const buf = uniformsRef.current.uSupportTips.value;
    if (supportCoverageTips && supportCoverageTips.count > 0) {
      const len = Math.min(buf.length, supportCoverageTips.tips.length);
      for (let i = 0; i < len; i += 1) buf[i] = supportCoverageTips.tips[i];
      // Zero the tail so a shrinking tip list doesn't keep ghost entries.
      for (let i = len; i < buf.length; i += 1) buf[i] = 0;
      uniformsRef.current.uSupportTipCount.value = Math.min(
        MAX_SUPPORT_TIPS,
        supportCoverageTips.count,
      );
    } else {
      uniformsRef.current.uSupportTipCount.value = 0;
    }
  }, [supportCoverageTips]);

  React.useEffect(() => {
    uniformsRef.current.uSupportCoverageColor.value.set(
      supportCoverageColor ?? '#00ff00',
    );
  }, [supportCoverageColor]);

  React.useEffect(() => {
    uniformsRef.current.uSupportCoverageIntensity.value = supportCoverageIntensity;
  }, [supportCoverageIntensity]);

  // Island marker sync — mirrors the support-tip pattern: copy into the
  // existing Float32Array so the bound uniform location keeps pointing
  // at the same buffer.
  React.useEffect(() => {
    const buf = uniformsRef.current.uIslandMarkers.value;
    if (islandMarkers && islandMarkers.count > 0) {
      const len = Math.min(buf.length, islandMarkers.markers.length);
      for (let i = 0; i < len; i += 1) buf[i] = islandMarkers.markers[i];
      for (let i = len; i < buf.length; i += 1) buf[i] = 0;
      uniformsRef.current.uIslandMarkerCount.value = Math.min(
        MAX_ISLAND_MARKERS,
        islandMarkers.count,
      );
    } else {
      uniformsRef.current.uIslandMarkerCount.value = 0;
    }
  }, [islandMarkers]);

  React.useEffect(() => { uniformsRef.current.uShowIslands.value = showIslands ? 1 : 0; }, [showIslands]);
  React.useEffect(() => { uniformsRef.current.uIslandColor.value.set(islandColor); }, [islandColor]);
  React.useEffect(() => { uniformsRef.current.uIslandIntensity.value = islandIntensity; }, [islandIntensity]);
  React.useEffect(() => { uniformsRef.current.uIslandRadiusFactor.value = islandRadiusFactor; }, [islandRadiusFactor]);
  React.useEffect(() => { uniformsRef.current.uIslandColumnHeight.value = islandColumnHeight; }, [islandColumnHeight]);

  React.useEffect(() => { uniformsRef.current.uShowOverhang.value = showOverhang ? 1 : 0; }, [showOverhang]);
  React.useEffect(() => { uniformsRef.current.uOverhangColor.value.set(overhangColor); }, [overhangColor]);
  React.useEffect(() => {
    uniformsRef.current.uOverhangCosThreshold.value = Math.cos((overhangAngleDeg * Math.PI) / 180);
  }, [overhangAngleDeg]);
  React.useEffect(() => { uniformsRef.current.uOverhangIntensity.value = overhangIntensity; }, [overhangIntensity]);
  React.useEffect(() => { uniformsRef.current.uOverhangProximityMm.value = overhangProximityMm; }, [overhangProximityMm]);

  // Set `customProgramCacheKey` via a ref callback so it's assigned the
  // moment R3F instantiates the material — BEFORE Three's renderer
  // compiles + caches the program for the first frame. A useEffect would
  // run after the first paint, when the program is already compiled and
  // cached under the previous key, so subsequent renders just keep
  // reusing the broken cached program.
  //
  // SOFTCLAY_SHADER_VERSION must be in the deps so HMR-replaced modules
  // get a new callback identity. With `[]`, the cached arrow keeps
  // referencing the *old* module's const binding — the live material
  // would still report the old cache key and Three would keep serving
  // the stale (pre-fix) program. Empirically verified in the shader-lab
  // sandbox at /Users/mag1/dev_tmp/ora/shader-lab/.
  const materialRefCallback = React.useCallback((mat: THREE.MeshStandardMaterial | null) => {
    if (!mat) return;
    mat.customProgramCacheKey = () => SOFTCLAY_SHADER_VERSION;
    mat.needsUpdate = true;
  }, [SOFTCLAY_SHADER_VERSION]);


  return (
    <meshStandardMaterial
      ref={materialRefCallback}
      vertexColors={useVertexColors ?? true}
      color={tintColor}
      emissive="#000000"
      emissiveIntensity={0}
      metalness={0.02}
      roughness={materialRoughness ?? 0.9}
      envMapIntensity={0.34}
      clippingPlanes={clippingPlanes}
      side={THREE.FrontSide}
      flatShading={false}
      onBeforeCompile={(shader) => {
        shader.uniforms.uFakeAoStrength = uniformsRef.current.uFakeAoStrength;
        shader.uniforms.uFakeLightDir = uniformsRef.current.uFakeLightDir;
        shader.uniforms.uSupportTips = uniformsRef.current.uSupportTips;
        shader.uniforms.uSupportTipCount = uniformsRef.current.uSupportTipCount;
        shader.uniforms.uSupportCoverageColor = uniformsRef.current.uSupportCoverageColor;
        shader.uniforms.uSupportCoverageIntensity = uniformsRef.current.uSupportCoverageIntensity;
        shader.uniforms.uIslandMarkers = uniformsRef.current.uIslandMarkers;
        shader.uniforms.uIslandMarkerCount = uniformsRef.current.uIslandMarkerCount;
        shader.uniforms.uShowIslands = uniformsRef.current.uShowIslands;
        shader.uniforms.uIslandColor = uniformsRef.current.uIslandColor;
        shader.uniforms.uIslandIntensity = uniformsRef.current.uIslandIntensity;
        shader.uniforms.uIslandRadiusFactor = uniformsRef.current.uIslandRadiusFactor;
        shader.uniforms.uIslandColumnHeight = uniformsRef.current.uIslandColumnHeight;
        shader.uniforms.uShowOverhang = uniformsRef.current.uShowOverhang;
        shader.uniforms.uOverhangColor = uniformsRef.current.uOverhangColor;
        shader.uniforms.uOverhangCosThreshold = uniformsRef.current.uOverhangCosThreshold;
        shader.uniforms.uOverhangIntensity = uniformsRef.current.uOverhangIntensity;
        shader.uniforms.uOverhangProximityMm = uniformsRef.current.uOverhangProximityMm;

        // Forward world position AND world-space normal to the fragment
        // shader. The world position is used for distance comparison
        // against support tips and island markers; the world normal
        // drives the overhang criterion. We compute world position
        // ourselves rather than reading from Three's `worldpos_vertex`
        // chunk's `worldPosition` variable — that variable is only
        // conditionally declared (envMap / shadows / transmission), so
        // referencing it on a plain meshStandardMaterial fails with
        // "worldPosition: undeclared identifier".
        shader.vertexShader = `
          varying vec3 vSupportWorldPos;
          varying vec3 vWorldNormalIsl;
        ` + shader.vertexShader;

        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
            #include <begin_vertex>
            vSupportWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
            vWorldNormalIsl  = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
          `,
        );

        shader.fragmentShader = `
          uniform float uFakeAoStrength;
          uniform vec3 uFakeLightDir;

          uniform vec4 uSupportTips[${MAX_SUPPORT_TIPS}];
          uniform int uSupportTipCount;
          uniform vec3 uSupportCoverageColor;
          uniform float uSupportCoverageIntensity;

          uniform vec4 uIslandMarkers[${MAX_ISLAND_MARKERS}];
          uniform int  uIslandMarkerCount;
          uniform float uShowIslands;
          uniform vec3  uIslandColor;
          uniform float uIslandIntensity;
          uniform float uIslandRadiusFactor;
          uniform float uIslandColumnHeight;

          uniform float uShowOverhang;
          uniform vec3  uOverhangColor;
          uniform float uOverhangCosThreshold;
          uniform float uOverhangIntensity;
          uniform float uOverhangProximityMm;

          varying vec3 vSupportWorldPos;
          varying vec3 vWorldNormalIsl;
        ` + shader.fragmentShader;

        // NOTE: Three.js r152+ renamed `<output_fragment>` to
        // `<opaque_fragment>`. r181 only ships the new name; using the
        // old one makes .replace() a silent no-op, dropping the halo +
        // diagnostic into a black hole.
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `
            #include <opaque_fragment>
            vec3 n = normalize(normal);
            float nDotL = max(dot(n, normalize(uFakeLightDir)), 0.0);
            float cavity = pow(1.0 - nDotL, 1.35);
            float fakeAo = 1.0 - (cavity * uFakeAoStrength);
            gl_FragColor.rgb *= fakeAo;

            // Support-coverage halo (per-pixel, polygon-independent).
            float halo = 0.0;
            for (int i = 0; i < ${MAX_SUPPORT_TIPS}; i++) {
              if (i >= uSupportTipCount) break;
              vec4 tip = uSupportTips[i];
              float radius = tip.w;
              if (radius <= 0.0) continue;
              float d = distance(vSupportWorldPos, tip.xyz);
              if (d >= radius) continue;
              float t = d / radius;
              float contribution = 1.0 - t * t * (3.0 - 2.0 * t);
              halo = max(halo, contribution);
            }
            halo *= uSupportCoverageIntensity;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uSupportCoverageColor, halo);

            // Island highlight — vertical column from baseZ up by
            // uIslandColumnHeight, radius = weight * uIslandRadiusFactor.
            // Soft falloff at the column's XY edge, hard cutoff in Z.
            if (uShowIslands > 0.5 && uIslandMarkerCount > 0) {
              float islandHalo = 0.0;
              for (int i = 0; i < ${MAX_ISLAND_MARKERS}; i++) {
                if (i >= uIslandMarkerCount) break;
                vec4 m = uIslandMarkers[i];
                if (m.w <= 0.0) continue;
                float radius = m.w * uIslandRadiusFactor;
                float dxy = length(vSupportWorldPos.xy - m.xy);
                if (dxy >= radius) continue;
                float zmin = m.z;
                float zmax = m.z + uIslandColumnHeight;
                if (vSupportWorldPos.z < zmin || vSupportWorldPos.z > zmax) continue;
                float tr = dxy / radius;
                islandHalo = max(islandHalo, 1.0 - tr * tr * (3.0 - 2.0 * tr));
              }
              islandHalo *= uIslandIntensity;
              gl_FragColor.rgb = mix(gl_FragColor.rgb, uIslandColor, islandHalo);
            }

            // Overhang — combined criterion: fragment normal points
            // downward past threshold AND fragment is within
            // uOverhangProximityMm of an island marker (filters out
            // cosmetic overhangs that already self-support).
            if (uShowOverhang > 0.5 && uIslandMarkerCount > 0) {
              float nz = vWorldNormalIsl.z;
              if (nz < -uOverhangCosThreshold) {
                float minD = 1e9;
                for (int i = 0; i < ${MAX_ISLAND_MARKERS}; i++) {
                  if (i >= uIslandMarkerCount) break;
                  vec4 m = uIslandMarkers[i];
                  if (m.w <= 0.0) continue;
                  minD = min(minD, distance(vSupportWorldPos, m.xyz));
                }
                if (minD < uOverhangProximityMm) {
                  float prox = 1.0 - clamp(minD / uOverhangProximityMm, 0.0, 1.0);
                  float steepness = clamp(
                    (-nz - uOverhangCosThreshold) / max(1.0 - uOverhangCosThreshold, 0.0001),
                    0.0, 1.0
                  );
                  float w = prox * steepness * uOverhangIntensity;
                  gl_FragColor.rgb = mix(gl_FragColor.rgb, uOverhangColor, w);
                }
              }
            }
          `,
        );
      }}
    />
  );
}
