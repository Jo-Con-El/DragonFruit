import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { supportPainterStore } from '../supportPainterStore';

/**
 * Computes a unique float ID for every triangle in flat/non-indexed geometry.
 */
function buildTriangleIdAttribute(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const positionAttr = geometry.getAttribute('position');
  if (!positionAttr) {
    throw new Error('Position attribute is missing from geometry');
  }
  const vertexCount = positionAttr.count;
  const array = new Float32Array(vertexCount);
  for (let k = 0; k < vertexCount; k++) {
    array[k] = Math.floor(k / 3);
  }
  return new THREE.BufferAttribute(array, 1);
}

/**
 * Renders high-quality color overlays per-triangle using a DataTexture lookup table.
 * Supports committed ROI blending and pulsing hover previews.
 */
export function useRoiHighlightMaterial(
  geometry: THREE.BufferGeometry | null,
  isActive: boolean,
  meshColor: string = '#c8c8ce',
  clippingPlanes: THREE.Plane[] = []
): { material: THREE.ShaderMaterial | null; geometry: THREE.BufferGeometry | null } {
  const timeRef = useRef<number>(0);
  const textureRef = useRef<THREE.DataTexture | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);

  // Parse mesh base color
  const baseColor = useMemo(() => {
    return new THREE.Color(meshColor || '#c8c8ce');
  }, [meshColor]);

  // Compute non-indexed rendering geometry copy if original is indexed
  const renderingGeometry = useMemo(() => {
    if (!geometry || !isActive) return geometry;

    console.log('[ROIHighlight] Creating dedicated rendering geometry copy for paint highlighting');
    let geom: THREE.BufferGeometry;
    try {
      if (geometry.index) {
        geom = geometry.toNonIndexed();
      } else {
        geom = geometry.clone();
      }

      // SYNCHRONOUS INITIALIZATION: Attach attribute BEFORE geometry is ever rendered
      const attr = buildTriangleIdAttribute(geom);
      geom.setAttribute('aTriangleId', attr);

      // Compute BVH bounds tree for collision detection & raycasting support
      (geom as any).computeBoundsTree?.();

      console.log('[ROIHighlight] Synchronously built attribute and computed BVH boundsTree');
    } catch (err) {
      console.error('[ROIHighlight] Failed to initialize rendering geometry copy', err);
      geom = geometry;
    }
    return geom;
  }, [geometry, isActive]);

  // Clean up non-indexed copy on change or unmount
  useEffect(() => {
    return () => {
      if (renderingGeometry && renderingGeometry !== geometry) {
        renderingGeometry.dispose();
      }
    };
  }, [renderingGeometry, geometry]);

  // Compute total triangle count
  const totalTriangleCount = useMemo(() => {
    if (!renderingGeometry) return 0;
    const pos = renderingGeometry.getAttribute('position');
    return pos ? Math.floor(pos.count / 3) : 0;
  }, [renderingGeometry]);

  // Setup DataTexture and ShaderMaterial
  const material = useMemo(() => {
    if (!renderingGeometry || totalTriangleCount === 0 || !isActive) return null;

    // 1. Create a 2D DataTexture to avoid GPU WebGL MAX_TEXTURE_SIZE limitations on large models
    const texWidth = 2048;
    const texHeight = Math.ceil(totalTriangleCount / texWidth);
    const size = texWidth * texHeight * 4; // RGBA
    const data = new Uint8Array(size);
    const texture = new THREE.DataTexture(
      data,
      texWidth,
      texHeight,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.flipY = false; // Explicitly disable flipping for precise row alignment
    texture.needsUpdate = true;
    textureRef.current = texture;

    // 2. Define Custom Shader Material with basic Diffuse shading for beautiful premium visuals
    const mat = new THREE.ShaderMaterial({
      precision: 'highp', // Enforce highp for high-density mesh indexing
      transparent: false, // Transition to opaque pass to guarantee absolute depth safety and GPU occlusion
      depthWrite: true,   // Write to depth buffer to align rendering queue
      depthTest: true,    // Explicitly enforce depth testing to guarantee occlusion by other surfaces
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uRoiMap: { value: texture },
        uRoiMapWidth: { value: texWidth },
        uRoiMapHeight: { value: texHeight },
        uTime: { value: 0 },
        uBaseColor: { value: baseColor },
      },
      vertexShader: `
        #include <clipping_planes_pars_vertex>
        attribute float aTriangleId;
        varying float vTriangleId;
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
          // Zero-dilation projection ensures absolute alignment with model geometry.
          // Relies entirely on GPU-hardware polygonOffset to pull the overlay in front,
          // which is mathematically immune to normal inversion or thin-wall bleeding.
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          #include <clipping_planes_vertex>
          vTriangleId = aTriangleId;
          vNormal = normalize(normalMatrix * normal);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        #include <clipping_planes_pars_fragment>
        uniform sampler2D uRoiMap;
        uniform float uRoiMapWidth;
        uniform float uRoiMapHeight;
        uniform float uTime;
        uniform vec3 uBaseColor;

        varying float vTriangleId;
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
          #include <clipping_planes_fragment>
          float triId = floor(vTriangleId + 0.5);
          float x = mod(triId, uRoiMapWidth) + 0.5;
          float y = floor(triId / uRoiMapWidth) + 0.5;
          vec2 uv = vec2(x / uRoiMapWidth, y / uRoiMapHeight);
          vec4 roi = texture2D(uRoiMap, uv);

          // Unpainted triangles are transparent/discarded from both color and depth passes
          if (roi.a <= 0.01) {
            discard;
          }

          vec3 normalVec = vNormal;
          if (length(normalVec) < 0.001) {
            normalVec = vec3(0.0, 0.0, 1.0);
          }
          vec3 normalizedNormal = normalize(normalVec);
          vec3 viewDir = normalize(vViewPosition);

          // Calculate silhouette edge outline mask
          float ndotv = abs(dot(normalizedNormal, viewDir));
          float edgeOutline = smoothstep(0.7, 0.9, 1.0 - ndotv);

          vec3 finalColor = roi.rgb;
          float emissiveBoost = 0.0;

          if (roi.a < 0.6) {
            // Proposed preview: pulse color blend between model base color and active brush color
            float pulse = 0.35 + 0.45 * sin(uTime * 8.0);
            finalColor = mix(uBaseColor, roi.rgb, pulse);
            emissiveBoost = pulse * 0.5;
          } else if (roi.a < 0.85) {
            // Selected/Focused region: slow sinusoidal pulse at ~1Hz
            float pulse = 0.7 + 0.3 * sin(uTime * 6.28318);
            finalColor = roi.rgb * pulse;
            emissiveBoost = 0.6 + pulse * 0.8;
            
            // Pulse active selection's silhouette black edge
            finalColor = mix(finalColor, vec3(0.0), edgeOutline * 0.95);
          } else {
            // Committed inactive ROI: no pulsing, static darkened cell-shaded silhouette outline
            finalColor = roi.rgb;
            emissiveBoost = 0.45;
            
            // Border is a static darkened outline of their respective color
            finalColor = mix(finalColor, roi.rgb * 0.25, edgeOutline * 0.85);
          }

          // Harmonic Diffuse Lambertian Lighting
          vec3 lightDir = normalize(vec3(0.5, 0.75, 1.0));
          float diffuse = max(0.28, dot(normalizedNormal, lightDir));
          vec3 litColor = finalColor * diffuse;

          // Boost self-emissive glow for high contrast
          litColor += finalColor * 0.25 * emissiveBoost;

          // Add a subtle rim light/ambient glow to the selection
          float rim = 1.0 - max(0.0, dot(normalizedNormal, vec3(0.0, 0.0, 1.0)));
          litColor += finalColor * pow(rim, 4.0) * 0.25 * emissiveBoost;

          gl_FragColor = vec4(litColor, 1.0);
        }
      `,
      side: THREE.FrontSide,
      clipping: true,
    });

    materialRef.current = mat;
    return mat;
  }, [renderingGeometry, totalTriangleCount, isActive, baseColor]);

  // Sync clipping planes dynamically
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.clippingPlanes = clippingPlanes;
    }
  }, [clippingPlanes]);

  // Sync state changes with the DataTexture using dynamic instantiation & disposal
  useEffect(() => {
    if (totalTriangleCount === 0 || !isActive || !material) return;

    const texWidth = 2048;
    const texHeight = Math.ceil(totalTriangleCount / texWidth);

    const handleUpdate = () => {
      const snap = supportPainterStore.getSnapshot();
      
      console.log(`[ROIHighlight] Re-instantiating fresh DataTexture for WebGL2 compatibility. Hovered: ${snap.hoveredTriangleId}, proposed: ${snap.proposedTriangleIds.size}`);

      // Allocate a fresh Uint8Array buffer
      const size = texWidth * texHeight * 4;
      const data = new Uint8Array(size);

      // Write committed regions & hover previews into texture data
      let writeCount = 0;
      for (const [triId, [r, g, b, a]] of snap.triangleColorMap.entries()) {
        if (triId >= 0 && triId < totalTriangleCount) {
          const offset = triId * 4;
          data[offset] = r;
          data[offset + 1] = g;
          data[offset + 2] = b;
          data[offset + 3] = a;
          writeCount++;
        }
      }

      // Instantiate a completely new DataTexture.
      // This is mathematically guaranteed to work under WebGL2 because it is treated
      // as a new texture allocation (never violates immutable texture limits).
      const newTexture = new THREE.DataTexture(
        data,
        texWidth,
        texHeight,
        THREE.RGBAFormat,
        THREE.UnsignedByteType
      );
      newTexture.minFilter = THREE.NearestFilter;
      newTexture.magFilter = THREE.NearestFilter;
      newTexture.generateMipmaps = false;
      newTexture.flipY = false;
      newTexture.needsUpdate = true;

      // Dispose of the previous texture to prevent GPU memory leaks
      const prevTexture = material.uniforms.uRoiMap.value;
      if (prevTexture && prevTexture !== newTexture) {
        console.log('[ROIHighlight] Disposing previous DataTexture.');
        prevTexture.dispose();
      }

      // Bind the fresh texture instance to the material uniform
      material.uniforms.uRoiMap.value = newTexture;
      textureRef.current = newTexture;
      console.log(`[ROIHighlight] Successfully bound new DataTexture with ${writeCount} triangles. needsUpdate flagged.`);
    };

    // Initialize with current state
    handleUpdate();

    // Subscribe to store updates
    const unsubscribe = supportPainterStore.subscribe(handleUpdate);
    return () => {
      unsubscribe();
      // Clean up texture when the effect is destroyed
      if (textureRef.current) {
        console.log('[ROIHighlight] Disposing final DataTexture on cleanup.');
        textureRef.current.dispose();
        textureRef.current = null;
      }
    };
  }, [totalTriangleCount, isActive, material]);

  // Drive the pulse animations in useFrame
  useFrame((state) => {
    timeRef.current = state.clock.getElapsedTime();
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = timeRef.current;
    }
  });

  // Clean up WebGL resources
  useEffect(() => {
    return () => {
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }
      if (materialRef.current) {
        materialRef.current.dispose();
        materialRef.current = null;
      }
    };
  }, []);

  return { material, geometry: renderingGeometry };
}
