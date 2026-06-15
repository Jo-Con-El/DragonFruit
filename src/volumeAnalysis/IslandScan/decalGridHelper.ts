import * as THREE from 'three';
import type { IslandMarker } from './islandOverlayLogic';

export interface DecalGridResult {
  gridTexture: THREE.DataTexture;
  markerTexture: THREE.DataTexture;
  bboxMin: THREE.Vector3;
  bboxMax: THREE.Vector3;
}

export function generateDecalGrid(
  markers: IslandMarker[],
  bbox: THREE.Box3 | null
): DecalGridResult {
  if (!bbox || markers.length === 0) {
    // Return dummy 1x1 textures to avoid WebGL binding errors
    const dummyGrid = new Float32Array(4);
    dummyGrid.fill(-1.0);
    const dummyMarker = new Float32Array(4);
    
    const gridTexture = new THREE.DataTexture(dummyGrid, 1, 1, THREE.RGBAFormat, THREE.FloatType);
    gridTexture.needsUpdate = true;
    const markerTexture = new THREE.DataTexture(dummyMarker, 1, 1, THREE.RGBAFormat, THREE.FloatType);
    markerTexture.needsUpdate = true;

    return {
      gridTexture,
      markerTexture,
      bboxMin: new THREE.Vector3(),
      bboxMax: new THREE.Vector3(),
    };
  }

  const min = bbox.min;
  const max = bbox.max;
  const dx = (max.x - min.x) || 1.0;
  const dy = (max.y - min.y) || 1.0;

  // 1. Build the 1D Marker Texture
  const markerCount = markers.length;
  const markerData = new Float32Array(markerCount * 4);

  for (let i = 0; i < markerCount; i++) {
    const marker = markers[i];
    const cx = marker.centerX;
    const cy = marker.centerY;
    const cz = marker.baseZ;
    const r = (marker as any).radius ?? 0.25;

    const markerAny = marker as any;
    // Determine type: 0: voxel, 1: minima, 2: intersection, 3: selected
    let type = 0;
    if (markerAny.color === '#00ff00' || marker.id >= 1000000) {
      type = 1; // minima
    } else if (markerAny.color === '#ff0000') {
      type = 2; // intersection
    }

    // Pack values into the alpha channel: (ID + 1) * 1000 + Type * 100 + Radius
    const packedVal = (marker.id + 1) * 1000 + type * 100 + r;

    markerData[i * 4] = cx;
    markerData[i * 4 + 1] = cy;
    markerData[i * 4 + 2] = cz;
    markerData[i * 4 + 3] = packedVal;
  }

  const markerTexture = new THREE.DataTexture(markerData, markerCount, 1, THREE.RGBAFormat, THREE.FloatType);
  markerTexture.minFilter = THREE.NearestFilter;
  markerTexture.magFilter = THREE.NearestFilter;
  markerTexture.needsUpdate = true;

  // 2. Build the 2D Spatial Index Grid Texture
  const W = 256;
  const H = 256;
  const gridData = new Float32Array(W * H * 4);
  gridData.fill(-1.0); // Initialize all index slots to -1.0

  for (let i = 0; i < markerCount; i++) {
    const marker = markers[i];
    if (marker.id < 0) continue; // Skip utility/seed markers

    const cx = marker.centerX;
    const cy = marker.centerY;
    const r = (marker as any).radius ?? 0.25;
    const rDilated = r + 0.2; // Dilation padding to ensure smooth fragment shader interpolation near boundaries

    // Find the cell bounding box in grid space
    const xStart = Math.max(0, Math.floor(((cx - rDilated - min.x) / dx) * W));
    const xEnd = Math.min(W - 1, Math.ceil(((cx + rDilated - min.x) / dx) * W));
    const yStart = Math.max(0, Math.floor(((cy - rDilated - min.y) / dy) * H));
    const yEnd = Math.min(H - 1, Math.ceil(((cy + rDilated - min.y) / dy) * H));

    const rDilatedSq = rDilated * rDilated;

    // Rasterize marker index into overlapping grid cells
    for (let gy = yStart; gy <= yEnd; gy++) {
      const cellY = min.y + ((gy + 0.5) / H) * dy;
      const dyVal = cellY - cy;

      for (let gx = xStart; gx <= xEnd; gx++) {
        const cellX = min.x + ((gx + 0.5) / W) * dx;
        const dxVal = cellX - cx;

        if (dxVal * dxVal + dyVal * dyVal <= rDilatedSq) {
          const pixelIdx = (gx + gy * W) * 4;
          
          // Store index in the first available channel slot
          for (let c = 0; c < 4; c++) {
            if (gridData[pixelIdx + c] === -1.0) {
              gridData[pixelIdx + c] = i;
              break;
            }
          }
        }
      }
    }
  }

  const gridTexture = new THREE.DataTexture(gridData, W, H, THREE.RGBAFormat, THREE.FloatType);
  gridTexture.minFilter = THREE.NearestFilter;
  gridTexture.magFilter = THREE.NearestFilter;
  gridTexture.wrapS = THREE.ClampToEdgeWrapping;
  gridTexture.wrapT = THREE.ClampToEdgeWrapping;
  gridTexture.needsUpdate = true;

  return {
    gridTexture,
    markerTexture,
    bboxMin: min.clone(),
    bboxMax: max.clone(),
  };
}
