import * as THREE from 'three';
import { BrushType, CustomBrushTemplate } from './supportPainterTypes';

export interface ClientAdjacencyMap {
  faceCount: number;
  faceToFaces: number[][];
  faceNormals: THREE.Vector3[];
  faceCentroids: THREE.Vector3[];
  faceZBounds: { min: number; max: number }[];
}

/**
 * Builds a high-performance face adjacency map and spatial cache on the client side
 * directly from the Three.js BufferGeometry, in LOCAL SPACE to ensure 100% robustness
 * against transform timing, scales, and rotation states.
 */
export function buildClientAdjacencyMap(geometry: THREE.BufferGeometry): ClientAdjacencyMap {
  let geom = geometry;
  let needsDispose = false;

  if (geometry.index) {
    console.log('[useClientAdjacencyMap] Converting indexed geometry to non-indexed for accurate adjacency map building');
    try {
      geom = geometry.toNonIndexed();
      needsDispose = true;
    } catch (err) {
      console.error('[useClientAdjacencyMap] Failed to convert indexed geometry to non-indexed', err);
    }
  }

  const posAttr = geom.getAttribute('position') as THREE.BufferAttribute;
  if (!posAttr) {
    if (needsDispose) geom.dispose();
    return { faceCount: 0, faceToFaces: [], faceNormals: [], faceCentroids: [], faceZBounds: [] };
  }
  const positions = posAttr.array;
  const faceCount = posAttr.count / 3;

  const faceToFaces: number[][] = Array.from({ length: faceCount }, () => []);
  const faceNormals: THREE.Vector3[] = [];
  const faceCentroids: THREE.Vector3[] = [];
  const faceZBounds: { min: number; max: number }[] = [];

  // Quantization key for vertex welding (5 decimal places, 1e-5 mm tolerance)
  const vertexToFacesMap = new Map<string, number[]>();

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();

  const getVertexKey = (x: number, y: number, z: number): string => {
    return `${Math.round(x * 100000)},${Math.round(y * 100000)},${Math.round(z * 100000)}`;
  };

  for (let f = 0; f < faceCount; f++) {
    const o = f * 9;
    v0.set(positions[o], positions[o + 1], positions[o + 2]);
    v1.set(positions[o + 3], positions[o + 4], positions[o + 5]);
    v2.set(positions[o + 6], positions[o + 7], positions[o + 8]);

    // 1. Centroid
    const centroid = new THREE.Vector3(
      (v0.x + v1.x + v2.x) / 3,
      (v0.y + v1.y + v2.y) / 3,
      (v0.z + v1.z + v2.z) / 3
    );
    faceCentroids.push(centroid);

    // 2. Normal
    edge1.subVectors(v1, v0);
    edge2.subVectors(v2, v0);
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize();
    faceNormals.push(normal);

    // 3. Z Bounds
    const minZ = Math.min(v0.z, v1.z, v2.z);
    const maxZ = Math.max(v0.z, v1.z, v2.z);
    faceZBounds.push({ min: minZ, max: maxZ });

    // 4. Welding index
    const k0 = getVertexKey(v0.x, v0.y, v0.z);
    const k1 = getVertexKey(v1.x, v1.y, v1.z);
    const k2 = getVertexKey(v2.x, v2.y, v2.z);

    for (const key of [k0, k1, k2]) {
      let list = vertexToFacesMap.get(key);
      if (!list) {
        list = [];
        vertexToFacesMap.set(key, list);
      }
      list.push(f);
    }
  }

  // Build Face-to-Face Adjacency (faces sharing at least 2 coincident vertices)
  const sharedCounts = new Map<number, number>();

  for (let f = 0; f < faceCount; f++) {
    const o = f * 9;
    v0.set(positions[o], positions[o + 1], positions[o + 2]);
    v1.set(positions[o + 3], positions[o + 4], positions[o + 5]);
    v2.set(positions[o + 6], positions[o + 7], positions[o + 8]);

    const k0 = getVertexKey(v0.x, v0.y, v0.z);
    const k1 = getVertexKey(v1.x, v1.y, v1.z);
    const k2 = getVertexKey(v2.x, v2.y, v2.z);

    sharedCounts.clear();
    for (const key of [k0, k1, k2]) {
      const list = vertexToFacesMap.get(key) || [];
      for (const other of list) {
        if (other === f) continue;
        sharedCounts.set(other, (sharedCounts.get(other) || 0) + 1);
      }
    }

    for (const [other, count] of sharedCounts.entries()) {
      if (count >= 2) {
        faceToFaces[f].push(other);
      }
    }
  }

  if (needsDispose) {
    geom.dispose();
  }

  return {
    faceCount,
    faceToFaces,
    faceNormals,
    faceCentroids,
    faceZBounds,
  };
}

/**
 * Executes a high-performance client-side region-wrapping search based on the active smart brush,
 * resolving Z-overhangs and centroids on-the-fly dynamically relative to the model's matrixWorld.
 */
export function proposeRegionOnClient(
  map: ClientAdjacencyMap,
  seedFaceIndex: number,
  brushType: BrushType,
  matrixWorld: THREE.Matrix4,
  brushRadiusMm: number = 4.0,
  customBrush?: CustomBrushTemplate
): number[] {
  if (seedFaceIndex < 0 || seedFaceIndex >= map.faceCount) return [];

  // Compute local up vector and world scale on-the-fly from the live matrixWorld
  const inv = new THREE.Matrix4().copy(matrixWorld).invert();
  const localUp = new THREE.Vector3(0, 0, 1).transformDirection(inv);

  const scale = new THREE.Vector3();
  matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  const worldScale = (scale.x + scale.y + scale.z) / 3;

  switch (brushType) {
    case 'MacroFace':
      return walkMacroFace(map, seedFaceIndex, localUp, customBrush);
    case 'Ridge':
      return walkRidge(map, seedFaceIndex, localUp);
    case 'CylinderSides':
      return walkCylinderSides(map, seedFaceIndex, localUp);
    case 'CylinderMinima':
      return walkCylinderMinima(map, seedFaceIndex, localUp);
    case 'Point':
      return walkManualCircle(map, seedFaceIndex, localUp, worldScale, brushRadiusMm);
    case 'ManualCircle':
      return walkManualCircle(map, seedFaceIndex, localUp, worldScale, brushRadiusMm);
    case 'ManualSquare':
      return walkManualSquare(map, seedFaceIndex, localUp, worldScale, brushRadiusMm);
    case 'Ring':
      return walkRing(map, seedFaceIndex, localUp, matrixWorld);
    default:
      // Legacy 1-ring fallback
      if (map.faceNormals[seedFaceIndex].dot(localUp) <= 0.2) {
        const list = [seedFaceIndex, ...map.faceToFaces[seedFaceIndex]];
        return list.filter((idx) => idx === seedFaceIndex || map.faceNormals[idx].dot(localUp) <= 0.2);
      }
      return [];
  }
}

// --- Smart Brush Graph Search Walks ---

function getFaceCurvature(map: ClientAdjacencyMap, faceIdx: number): number {
  const norm = map.faceNormals[faceIdx];
  const neighbors = map.faceToFaces[faceIdx];
  if (neighbors.length === 0) return 0;
  let maxAngle = 0;
  for (const adj of neighbors) {
    const angle = norm.angleTo(map.faceNormals[adj]);
    if (angle > maxAngle) maxAngle = angle;
  }
  return maxAngle;
}

function walkMacroFace(
  map: ClientAdjacencyMap,
  seed: number,
  localUp: THREE.Vector3,
  customBrush?: CustomBrushTemplate
): number[] {
  const visited = new Set<number>();
  const queue: number[] = [seed];
  visited.add(seed);

  const seedNormal = map.faceNormals[seed];
  const selection = customBrush?.selection;
  const degToRad = Math.PI / 180;
  const localDown = new THREE.Vector3().copy(localUp).negate();

  // Overhang slope check for seed
  if (selection) {
    const minSlopeRad = selection.overhangSlopeMinDeg * degToRad;
    const maxSlopeRad = selection.overhangSlopeMaxDeg * degToRad;
    const seedSlope = seedNormal.angleTo(localDown);
    if (seedSlope < minSlopeRad || seedSlope > maxSlopeRad) return [];
  } else {
    if (seedNormal.dot(localUp) > 0.2) return [];
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const adjs = map.faceToFaces[curr];

    for (const adj of adjs) {
      if (!visited.has(adj)) {
        const nAdj = map.faceNormals[adj];
        
        let slopeOk = false;
        if (selection) {
          const minSlopeRad = selection.overhangSlopeMinDeg * degToRad;
          const maxSlopeRad = selection.overhangSlopeMaxDeg * degToRad;
          const adjSlope = nAdj.angleTo(localDown);
          slopeOk = adjSlope >= minSlopeRad && adjSlope <= maxSlopeRad;
        } else {
          slopeOk = nAdj.dot(localUp) <= 0.2;
        }

        if (slopeOk) {
          const normalDeviation = seedNormal.angleTo(nAdj);
          const nCurr = map.faceNormals[curr];
          const edgeDihedral = nCurr.angleTo(nAdj);

          if (selection) {
            let curvatureOk = true;
            if (selection.curvatureMin !== undefined || selection.curvatureMax !== undefined) {
              const maxDihedral = getFaceCurvature(map, adj);
              const curvMin = selection.curvatureMin ?? 0;
              const curvMax = selection.curvatureMax ?? 1;
              curvatureOk = maxDihedral >= curvMin && maxDihedral <= curvMax;
            }

            const minConeRad = selection.normalConeAngleMinDeg * degToRad;
            const maxConeRad = selection.normalConeAngleMaxDeg * degToRad;
            const dihedralTolRad = selection.dihedralAngleToleranceDeg * degToRad;

            const normalConeOk = normalDeviation >= minConeRad && normalDeviation <= maxConeRad;
            const dihedralOk = edgeDihedral <= dihedralTolRad;

            if (normalConeOk && dihedralOk && curvatureOk) {
              visited.add(adj);
              queue.push(adj);
            }
          } else {
            // 35 deg = 0.61 rad, 25 deg = 0.43 rad
            if (normalDeviation < 0.61 && edgeDihedral < 0.43) {
              visited.add(adj);
              queue.push(adj);
            }
          }
        }
      }
    }
  }

  if (selection) {
    const minSlopeRad = selection.overhangSlopeMinDeg * degToRad;
    const maxSlopeRad = selection.overhangSlopeMaxDeg * degToRad;
    return Array.from(visited).filter((idx) => {
      if (idx === seed) return true;
      const slope = map.faceNormals[idx].angleTo(localDown);
      return slope >= minSlopeRad && slope <= maxSlopeRad;
    });
  } else {
    return Array.from(visited).filter((idx) => idx === seed || map.faceNormals[idx].dot(localUp) <= 0.2);
  }
}

function walkRidge(map: ClientAdjacencyMap, seed: number, localUp: THREE.Vector3): number[] {
  const visited = new Set<number>();
  const seedNormal = map.faceNormals[seed];
  if (seedNormal.dot(localUp) > 0.2) return [];

  const HIGH_THRESHOLD = 8 * (Math.PI / 180);  // 8 degrees
  const LOW_THRESHOLD = 3 * (Math.PI / 180);   // 3 degrees

  const getPeakCurvature = (f: number): { neighborIdx: number; angle: number } => {
    const norm = map.faceNormals[f];
    let maxAngle = 0;
    let neighborIdx = -1;
    for (const adj of map.faceToFaces[f]) {
      const angle = norm.angleTo(map.faceNormals[adj]);
      if (angle > maxAngle) {
        maxAngle = angle;
        neighborIdx = adj;
      }
    }
    return { neighborIdx, angle: maxAngle };
  };

  const seedPeak = getPeakCurvature(seed);
  if (seedPeak.angle < HIGH_THRESHOLD) return [];
  visited.add(seed);

  const propagateChain = (startFace: number) => {
    let curr = startFace;
    while (true) {
      const { neighborIdx, angle } = getPeakCurvature(curr);
      if (neighborIdx === -1 || angle < LOW_THRESHOLD) break;

      // Compute local ridge axis vector
      const normCurr = map.faceNormals[curr];
      const normCrease = map.faceNormals[neighborIdx];
      const grad = new THREE.Vector3().subVectors(normCurr, normCrease);
      const ridgeAxis = new THREE.Vector3().crossVectors(normCurr, grad);
      if (ridgeAxis.lengthSq() < 1e-6) break;
      ridgeAxis.normalize();

      // Look at unvisited neighbors and choose the one closest to the ridge axis
      const adjs = map.faceToFaces[curr];
      let bestAdj = -1;
      let bestScore = -1;

      for (const adj of adjs) {
        if (visited.has(adj)) continue;
        if (map.faceNormals[adj].dot(localUp) > 0.2) continue; // Overhang constraint

        const adjPeak = getPeakCurvature(adj);
        if (adjPeak.angle < LOW_THRESHOLD) continue;

        // Compute direction displacement vector
        const disp = new THREE.Vector3().subVectors(map.faceCentroids[adj], map.faceCentroids[curr]);
        if (disp.lengthSq() < 1e-6) continue;
        disp.normalize();

        const score = Math.abs(disp.dot(ridgeAxis));
        if (score > bestScore) {
          bestScore = score;
          bestAdj = adj;
        }
      }

      if (bestAdj === -1 || bestScore < 0.3) break;
      curr = bestAdj;
      visited.add(curr);
    }
  };

  const normSeed = map.faceNormals[seed];
  const normCreaseSeed = map.faceNormals[seedPeak.neighborIdx];
  const gradSeed = new THREE.Vector3().subVectors(normSeed, normCreaseSeed);
  const ridgeAxisSeed = new THREE.Vector3().crossVectors(normSeed, gradSeed);

  if (ridgeAxisSeed.lengthSq() < 1e-6) {
    // Fallback if cross product is degenerate
    const fallbacks = map.faceToFaces[seed].filter(
      (adj) => getPeakCurvature(adj).angle >= LOW_THRESHOLD && map.faceNormals[adj].dot(localUp) <= 0.2
    );
    if (fallbacks.length > 0) {
      visited.add(fallbacks[0]);
      propagateChain(fallbacks[0]);
    }
    if (fallbacks.length > 1) {
      visited.add(fallbacks[1]);
      propagateChain(fallbacks[1]);
    }
  } else {
    ridgeAxisSeed.normalize();

    const adjsSeed = map.faceToFaces[seed];
    let bestForwardAdj = -1;
    let bestForwardScore = -1;
    let bestBackwardAdj = -1;
    let bestBackwardScore = -1;

    for (const adj of adjsSeed) {
      if (map.faceNormals[adj].dot(localUp) > 0.2) continue;
      const adjPeak = getPeakCurvature(adj);
      if (adjPeak.angle < LOW_THRESHOLD) continue;

      const disp = new THREE.Vector3().subVectors(map.faceCentroids[adj], map.faceCentroids[seed]);
      if (disp.lengthSq() < 1e-6) continue;
      disp.normalize();

      const dotVal = disp.dot(ridgeAxisSeed);
      const score = Math.abs(dotVal);
      if (dotVal > 0) {
        if (score > bestForwardScore) {
          bestForwardScore = score;
          bestForwardAdj = adj;
        }
      } else {
        if (score > bestBackwardScore) {
          bestBackwardScore = score;
          bestBackwardAdj = adj;
        }
      }
    }

    if (bestForwardAdj !== -1 && bestForwardScore >= 0.3) {
      visited.add(bestForwardAdj);
      propagateChain(bestForwardAdj);
    }
    if (bestBackwardAdj !== -1 && bestBackwardScore >= 0.3) {
      visited.add(bestBackwardAdj);
      propagateChain(bestBackwardAdj);
    }
  }

  return Array.from(visited).filter((idx) => idx === seed || map.faceNormals[idx].dot(localUp) <= 0.2);
}

function walkCylinderSides(map: ClientAdjacencyMap, seed: number, localUp: THREE.Vector3): number[] {
  const visited = new Set<number>();
  const queue: number[] = [];

  const isAnisotropicCylinder = (f: number): boolean => {
    const norm = map.faceNormals[f];
    const angles = map.faceToFaces[f].map((adj) => norm.angleTo(map.faceNormals[adj]));
    if (angles.length === 0) return false;
    const maxAngle = Math.max(...angles);
    const minAngle = Math.min(...angles);
    // Anisotropic cylinder condition: curved in one direction (> 0.03 rad) and flat in another (< 0.05 rad)
    return maxAngle > 0.03 && minAngle < 0.05;
  };

  if (map.faceNormals[seed].dot(localUp) <= 0.2 && isAnisotropicCylinder(seed)) {
    queue.push(seed);
    visited.add(seed);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const adjs = map.faceToFaces[curr];
      for (const adj of adjs) {
        if (!visited.has(adj)) {
          if (map.faceNormals[adj].dot(localUp) <= 0.2 && isAnisotropicCylinder(adj)) {
            visited.add(adj);
            queue.push(adj);
          }
        }
      }
    }
  }

  return Array.from(visited).filter((idx) => idx === seed || map.faceNormals[idx].dot(localUp) <= 0.2);
}

function walkCylinderMinima(map: ClientAdjacencyMap, seed: number, localUp: THREE.Vector3): number[] {
  const visited = new Set<number>();

  const isAnisotropicCylinder = (f: number): boolean => {
    const norm = map.faceNormals[f];
    const angles = map.faceToFaces[f].map((adj) => norm.angleTo(map.faceNormals[adj]));
    if (angles.length === 0) return false;
    const maxAngle = Math.max(...angles);
    const minAngle = Math.min(...angles);
    return maxAngle > 0.03 && minAngle < 0.05;
  };

  if (map.faceNormals[seed].dot(localUp) <= 0.2 && isAnisotropicCylinder(seed)) {
    visited.add(seed);

    const getCylinderCandidates = (f: number): number[] => {
      const list: number[] = [];
      for (const adj of map.faceToFaces[f]) {
        if (visited.has(adj)) continue;
        if (map.faceNormals[adj].dot(localUp) > 0.2) continue;
        if (isAnisotropicCylinder(adj)) {
          list.push(adj);
        }
      }
      list.sort((a, b) => map.faceNormals[a].dot(localUp) - map.faceNormals[b].dot(localUp));
      return list;
    };

    const candidates = getCylinderCandidates(seed);

    if (candidates.length > 0) {
      let curr = candidates[0];
      visited.add(curr);
      while (true) {
        const next = getCylinderCandidates(curr);
        if (next.length === 0) break;
        curr = next[0];
        visited.add(curr);
      }
    }

    if (candidates.length > 1) {
      let curr = candidates[1];
      visited.add(curr);
      while (true) {
        const next = getCylinderCandidates(curr);
        if (next.length === 0) break;
        curr = next[0];
        visited.add(curr);
      }
    }
  }

  return Array.from(visited).filter((idx) => idx === seed || map.faceNormals[idx].dot(localUp) <= 0.2);
}

function walkManualCircle(
  map: ClientAdjacencyMap,
  seed: number,
  localUp: THREE.Vector3,
  worldScale: number,
  radiusMm: number
): number[] {
  const proposed: number[] = [];
  const dists = new Map<number, number>();
  
  interface DijkstraState {
    cost: number;
    face: number;
  }

  const queue: DijkstraState[] = [];
  if (map.faceNormals[seed].dot(localUp) <= 0.2) {
    dists.set(seed, 0);
    queue.push({ cost: 0, face: seed });

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const { cost, face } = queue.shift()!;

      if (cost > radiusMm) continue;
      if (!proposed.includes(face)) {
        proposed.push(face);
      }

      const centroidCurr = map.faceCentroids[face];
      const adjs = map.faceToFaces[face];

      for (const adj of adjs) {
        if (map.faceNormals[adj].dot(localUp) <= 0.2) {
          const centroidAdj = map.faceCentroids[adj];
          const stepCost = centroidCurr.distanceTo(centroidAdj) * worldScale;
          const nextCost = cost + stepCost;

          const currentBest = dists.get(adj) ?? Infinity;
          if (nextCost < currentBest && nextCost <= radiusMm) {
            dists.set(adj, nextCost);
            queue.push({ cost: nextCost, face: adj });
          }
        }
      }
    }
  }

  return proposed.filter((idx) => idx === seed || map.faceNormals[idx].dot(localUp) <= 0.2);
}

function walkManualSquare(
  map: ClientAdjacencyMap,
  seed: number,
  localUp: THREE.Vector3,
  worldScale: number,
  radiusMm: number
): number[] {
  const proposed: number[] = [];
  const dists = new Map<number, number>();
  
  const seedNormal = map.faceNormals[seed];
  const seedCentroid = map.faceCentroids[seed];
  
  if (seedNormal.dot(localUp) > 0.2) return [];

  // Construct local orthonormal tangent coordinate axes on the seed plane
  const tangentU = new THREE.Vector3(1, 0, 0).cross(seedNormal);
  if (tangentU.lengthSq() < 1e-4) {
    tangentU.copy(new THREE.Vector3(0, 1, 0).cross(seedNormal));
  }
  tangentU.normalize();
  const tangentV = new THREE.Vector3().crossVectors(seedNormal, tangentU).normalize();

  interface DijkstraState {
    cost: number;
    face: number;
  }

  const queue: DijkstraState[] = [];
  dists.set(seed, 0);
  queue.push({ cost: 0, face: seed });

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { cost, face } = queue.shift()!;

    if (cost > radiusMm * 1.414) continue; // Diagonal max bound guard

    // Project face centroid vector onto seed tangent plane
    const faceCentroid = map.faceCentroids[face];
    const diff = new THREE.Vector3().subVectors(faceCentroid, seedCentroid).multiplyScalar(worldScale);
    const du = diff.dot(tangentU);
    const dv = diff.dot(tangentV);

    // Apply square boundary clamp: |du| <= R and |dv| <= R
    if (Math.abs(du) <= radiusMm && Math.abs(dv) <= radiusMm) {
      if (!proposed.includes(face)) {
        proposed.push(face);
      }
    }

    const centroidCurr = map.faceCentroids[face];
    const adjs = map.faceToFaces[face];

    for (const adj of adjs) {
      if (map.faceNormals[adj].dot(localUp) <= 0.2) {
        const centroidAdj = map.faceCentroids[adj];
        const stepCost = centroidCurr.distanceTo(centroidAdj) * worldScale;
        const nextCost = cost + stepCost;

        const currentBest = dists.get(adj) ?? Infinity;
        if (nextCost < currentBest && nextCost <= radiusMm * 1.414) {
          dists.set(adj, nextCost);
          queue.push({ cost: nextCost, face: adj });
        }
      }
    }
  }

  return proposed.filter((idx) => idx === seed || map.faceNormals[idx].dot(localUp) <= 0.2);
}

function walkRing(map: ClientAdjacencyMap, seed: number, localUp: THREE.Vector3, matrixWorld: THREE.Matrix4): number[] {
  const visited = new Set<number>();
  const queue: number[] = [];

  if (map.faceNormals[seed].dot(localUp) <= 0.2) {
    const seedCentroidWorld = map.faceCentroids[seed].clone().applyMatrix4(matrixWorld);
    const seedZ = seedCentroidWorld.z;

    queue.push(seed);
    visited.add(seed);

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const adjs = map.faceToFaces[curr];

      for (const adj of adjs) {
        if (!visited.has(adj)) {
          if (map.faceNormals[adj].dot(localUp) <= 0.2) {
            const adjCentroidWorld = map.faceCentroids[adj].clone().applyMatrix4(matrixWorld);
            if (adjCentroidWorld.z <= seedZ + 1.0 && adjCentroidWorld.z >= seedZ - 1.0) {
              visited.add(adj);
              queue.push(adj);
            }
          }
        }
      }
    }
  }

  return Array.from(visited).filter((idx) => idx === seed || map.faceNormals[idx].dot(localUp) <= 0.2);
}
