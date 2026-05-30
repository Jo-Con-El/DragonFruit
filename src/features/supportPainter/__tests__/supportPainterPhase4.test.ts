import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { type ClientAdjacencyMap, proposeRegionOnClient } from '../useClientAdjacencyMap';
import { supportPainterStore } from '../supportPainterStore';
import { type ROIRegion } from '../supportPainterTypes';

describe('Support Painter Phase 4 - Manual Geodesic Brushes & Boolean Operations', () => {

  // ─── Setup Flat 3x3 Grid Mesh for Dijkstra Walks ───────────────────────────
  // Coordinates are spaced 1.0mm apart:
  // 6: (0,2,0)   7: (1,2,0)   8: (2,2,0)
  // 3: (0,1,0)   4: (1,1,0)   5: (2,1,0)
  // 0: (0,0,0)   1: (1,0,0)   2: (2,0,0)
  const mockAdjacencyMap: ClientAdjacencyMap = {
    faceCount: 9,
    faceNormals: Array.from({ length: 9 }, () => new THREE.Vector3(0, 0, -1)), // Pointing downward (supportable overhang)
    faceCentroids: [
      new THREE.Vector3(0, 0, 0), // 0
      new THREE.Vector3(1, 0, 0), // 1
      new THREE.Vector3(2, 0, 0), // 2
      new THREE.Vector3(0, 1, 0), // 3
      new THREE.Vector3(1, 1, 0), // 4 (center)
      new THREE.Vector3(2, 1, 0), // 5
      new THREE.Vector3(0, 2, 0), // 6
      new THREE.Vector3(1, 2, 0), // 7
      new THREE.Vector3(2, 2, 0), // 8
    ],
    faceZBounds: Array.from({ length: 9 }, () => ({ min: -0.1, max: 0.1 })),
    faceToFaces: [
      [1, 3],       // 0
      [0, 2, 4],    // 1
      [1, 5],       // 2
      [0, 4, 6],    // 3
      [1, 3, 5, 7], // 4
      [2, 4, 8],    // 5
      [3, 7],       // 6
      [4, 6, 8],    // 7
      [5, 7],       // 8
    ],
  };

  const identityMatrix = new THREE.Matrix4();

  describe('Dijkstra Surface Walks & Clamping', () => {
    it('should select circular geodesic candidate faces within Dijkstra distance R', () => {
      // Circular walk with R = 1.5 from center (face 4).
      // Faces 1, 3, 5, 7 are at Dijkstra cost 1.0 (<= 1.5).
      // Faces 0, 2, 6, 8 are at Dijkstra cost 2.0 (> 1.5).
      const result = proposeRegionOnClient(
        mockAdjacencyMap,
        4, // Seed face 4
        'ManualCircle',
        identityMatrix,
        1.5 // Radius
      );

      assert.strictEqual(result.length, 5);
      assert.ok(result.includes(4));
      assert.ok(result.includes(1));
      assert.ok(result.includes(3));
      assert.ok(result.includes(5));
      assert.ok(result.includes(7));
      
      // Diagonals must be excluded because Dijkstra walk cost is 2.0
      assert.ok(!result.includes(0));
      assert.ok(!result.includes(2));
      assert.ok(!result.includes(6));
      assert.ok(!result.includes(8));
    });

    it('should select square geodesic candidate faces using local tangent projection clamping', () => {
      // Square walk with R = 1.5 from center (face 4).
      // tangent projection allows |du| <= 1.5 and |dv| <= 1.5
      // Max diagonal Dijkstra cost is 2.0 <= R * 1.414 = 2.121
      // Therefore, all 9 faces should be included.
      const result = proposeRegionOnClient(
        mockAdjacencyMap,
        4, // Seed face 4
        'ManualSquare',
        identityMatrix,
        1.5 // Radius
      );

      assert.strictEqual(result.length, 9);
      for (let i = 0; i < 9; i++) {
        assert.ok(result.includes(i), `Should contain face ${i}`);
      }
    });
  });

  describe('Connected-Component Graph BFS Orphan Pruner', () => {
    it('should silently prune disconnected painted triangle clusters starting from seed triangle', () => {
      // Setup a region with a main component and a disconnected orphan
      const regionId = 'test-prune-roi';
      const region: ROIRegion = {
        id: regionId,
        brushType: 'ManualCircle',
        seedTriangleId: 0, // Seed is 0
        triangleIds: new Set([0, 1, 3, 8]), // 0, 1, 3 are connected; 8 is an orphan
        color: '#06B6D4',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      supportPainterStore.clearAll();
      supportPainterStore.setClientAdjacencyMap(mockAdjacencyMap);
      
      const regionsMap = new Map<string, ROIRegion>();
      regionsMap.set(regionId, region);
      supportPainterStore.restoreRegions(regionsMap);

      // Prune
      supportPainterStore.pruneOrphans(regionId);

      const updated = supportPainterStore.getSnapshot().regions.get(regionId);
      assert.ok(updated);
      assert.strictEqual(updated.triangleIds.size, 3);
      assert.ok(updated.triangleIds.has(0));
      assert.ok(updated.triangleIds.has(1));
      assert.ok(updated.triangleIds.has(3));
      assert.ok(!updated.triangleIds.has(8), 'Orphan face 8 should be pruned');
    });

    it('should isolate and keep the largest connected component if the seed has been erased', () => {
      // Setup a region where seed is face 4, but face 4 is not in triangleIds (erased)
      // Component A: {0, 1, 3} (size 3)
      // Component B: {7, 8} (size 2)
      const regionId = 'test-erased-seed-roi';
      const region: ROIRegion = {
        id: regionId,
        brushType: 'ManualCircle',
        seedTriangleId: 4, // Seed 4 is missing from triangleIds
        triangleIds: new Set([0, 1, 3, 7, 8]),
        color: '#06B6D4',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      supportPainterStore.clearAll();
      supportPainterStore.setClientAdjacencyMap(mockAdjacencyMap);

      const regionsMap = new Map<string, ROIRegion>();
      regionsMap.set(regionId, region);
      supportPainterStore.restoreRegions(regionsMap);

      // Prune
      supportPainterStore.pruneOrphans(regionId);

      const updated = supportPainterStore.getSnapshot().regions.get(regionId);
      assert.ok(updated);
      // Largest component is {0, 1, 3} (size 3), while {7, 8} (size 2) is pruned
      assert.strictEqual(updated.triangleIds.size, 3);
      assert.ok(updated.triangleIds.has(0));
      assert.ok(updated.triangleIds.has(1));
      assert.ok(updated.triangleIds.has(3));
      assert.ok(!updated.triangleIds.has(7), 'Orphan component face 7 should be pruned');
      assert.ok(!updated.triangleIds.has(8), 'Orphan component face 8 should be pruned');
    });
  });

  describe('Set Boolean Operations & History Transactions', () => {
    it('should correctly perform union set operation on regions and clean up input states', () => {
      const rA: ROIRegion = {
        id: 'roi-a',
        brushType: 'ManualCircle',
        seedTriangleId: 0,
        triangleIds: new Set([0, 1, 2]),
        color: '#06B6D4',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      const rB: ROIRegion = {
        id: 'roi-b',
        brushType: 'ManualCircle',
        seedTriangleId: 4,
        triangleIds: new Set([2, 3, 4]),
        color: '#06B6D4',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      supportPainterStore.clearAll();
      const regionsMap = new Map<string, ROIRegion>();
      regionsMap.set(rA.id, rA);
      regionsMap.set(rB.id, rB);
      supportPainterStore.restoreRegions(regionsMap);

      // Perform Union (rA U rB)
      supportPainterStore.booleanOperate('union', 'roi-a', 'roi-b');

      const snapshot = supportPainterStore.getSnapshot();
      assert.ok(snapshot.regions.has('roi-a'));
      assert.ok(!snapshot.regions.has('roi-b'), 'Region B should be deleted after union');
      
      const unionRA = snapshot.regions.get('roi-a')!;
      assert.strictEqual(unionRA.triangleIds.size, 5);
      for (const id of [0, 1, 2, 3, 4]) {
        assert.ok(unionRA.triangleIds.has(id));
      }
    });

    it('should correctly perform subtract set operation on regions', () => {
      const rA: ROIRegion = {
        id: 'roi-a',
        brushType: 'ManualCircle',
        seedTriangleId: 0,
        triangleIds: new Set([0, 1, 2]),
        color: '#06B6D4',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      const rB: ROIRegion = {
        id: 'roi-b',
        brushType: 'ManualCircle',
        seedTriangleId: 4,
        triangleIds: new Set([2, 3, 4]),
        color: '#06B6D4',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      supportPainterStore.clearAll();
      const regionsMap = new Map<string, ROIRegion>();
      regionsMap.set(rA.id, rA);
      regionsMap.set(rB.id, rB);
      supportPainterStore.restoreRegions(regionsMap);

      // Perform Subtract (rA \ rB)
      supportPainterStore.booleanOperate('subtract', 'roi-a', 'roi-b');

      const snapshot = supportPainterStore.getSnapshot();
      assert.ok(snapshot.regions.has('roi-a'));
      assert.ok(snapshot.regions.has('roi-b'));

      const subRA = snapshot.regions.get('roi-a')!;
      assert.strictEqual(subRA.triangleIds.size, 2);
      assert.ok(subRA.triangleIds.has(0));
      assert.ok(subRA.triangleIds.has(1));
      assert.ok(!subRA.triangleIds.has(2), 'Intersection point should be subtracted');
    });

    it('should correctly perform intersect set operation on regions', () => {
      const rA: ROIRegion = {
        id: 'roi-a',
        brushType: 'ManualCircle',
        seedTriangleId: 0,
        triangleIds: new Set([0, 1, 2]),
        color: '#06B6D4',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      const rB: ROIRegion = {
        id: 'roi-b',
        brushType: 'ManualCircle',
        seedTriangleId: 4,
        triangleIds: new Set([2, 3, 4]),
        color: '#06B6D4',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      supportPainterStore.clearAll();
      const regionsMap = new Map<string, ROIRegion>();
      regionsMap.set(rA.id, rA);
      regionsMap.set(rB.id, rB);
      supportPainterStore.restoreRegions(regionsMap);

      // Perform Intersect (rA ∩ rB)
      supportPainterStore.booleanOperate('intersect', 'roi-a', 'roi-b');

      const snapshot = supportPainterStore.getSnapshot();
      assert.ok(snapshot.regions.has('roi-a'));
      
      const interRA = snapshot.regions.get('roi-a')!;
      assert.strictEqual(interRA.triangleIds.size, 1);
      assert.ok(interRA.triangleIds.has(2), 'Only the intersection face 2 should remain');
    });
  });

  describe('Ridge Crease Walk & Hysteresis', () => {
    it('should traverse along a soft-creased / faceted ridge using hysteresis thresholds and directional alignment', () => {
      // 3 faces representing a soft/faceted crease line
      // Face 0: flat horizontal base normal pointing down
      // Face 1: tilted slightly by 10 degrees (dihedral = 10° > HIGH_THRESHOLD 8°)
      // Face 2: tilted further by 5 degrees (dihedral = 5° > LOW_THRESHOLD 3°)
      const creaseAdjacencyMap: ClientAdjacencyMap = {
        faceCount: 3,
        faceNormals: [
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(0, Math.sin(10 * Math.PI / 180), -Math.cos(10 * Math.PI / 180)),
          new THREE.Vector3(0, Math.sin(15 * Math.PI / 180), -Math.cos(15 * Math.PI / 180)),
        ],
        faceCentroids: [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(2, 0, 0),
        ],
        faceZBounds: Array.from({ length: 3 }, () => ({ min: -0.1, max: 0.1 })),
        faceToFaces: [
          [1],    // 0
          [0, 2], // 1
          [1],    // 2
        ],
      };

      const result = proposeRegionOnClient(
        creaseAdjacencyMap,
        0, // Seed face 0
        'Ridge',
        identityMatrix
      );

      // The walk should accept seed 0 (peak curvature 10° >= 8° HIGH)
      // and successfully propagate through 1 (dihedral 10° >= 3°) and 2 (dihedral 5° >= 3°)
      assert.strictEqual(result.length, 3);
      assert.ok(result.includes(0), 'Should contain seed 0');
      assert.ok(result.includes(1), 'Should traverse to face 1');
      assert.ok(result.includes(2), 'Should traverse to soft face 2');
    });
  });

  describe('Custom Parameter Overrides', () => {
    it('should respect custom crease seed and propagation angle parameters in Ridge walks', () => {
      // 3 faces representing a soft/faceted crease line
      // Face 0: flat horizontal base normal pointing down
      // Face 1: tilted slightly by 10 degrees (dihedral = 10°)
      // Face 2: tilted further by 5 degrees (dihedral = 5°)
      const creaseAdjacencyMap: ClientAdjacencyMap = {
        faceCount: 3,
        faceNormals: [
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(0, Math.sin(10 * Math.PI / 180), -Math.cos(10 * Math.PI / 180)),
          new THREE.Vector3(0, Math.sin(15 * Math.PI / 180), -Math.cos(15 * Math.PI / 180)),
        ],
        faceCentroids: [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(1, 0, 0),
          new THREE.Vector3(2, 0, 0),
        ],
        faceZBounds: Array.from({ length: 3 }, () => ({ min: -0.1, max: 0.1 })),
        faceToFaces: [
          [1],    // 0
          [0, 2], // 1
          [1],    // 2
        ],
      };

      // 1. With creaseSeedAngleDeg = 12 (10° < 12°), should NOT seed!
      const mockCustomBrushNoSeed = {
        id: 'c1',
        name: 'No Seed',
        color: '#ff0000',
        selection: {
          normalConeAngleMinDeg: 0,
          normalConeAngleMaxDeg: 90,
          overhangSlopeMinDeg: 0,
          overhangSlopeMaxDeg: 90,
          curvatureMin: 0,
          curvatureMax: 1,
          dihedralAngleToleranceDeg: 45,
          creaseSeedAngleDeg: 12,
          creasePropagateAngleDeg: 3,
          ridgeAlignmentTolerance: 0.3,
        },
        operations: [],
      };

      const resNoSeed = proposeRegionOnClient(
        creaseAdjacencyMap,
        0,
        'Ridge',
        identityMatrix,
        4.0,
        mockCustomBrushNoSeed
      );
      assert.strictEqual(resNoSeed.length, 0, 'Should fail to seed because 10 deg crease < 12 deg seed threshold');

      // 2. With creaseSeedAngleDeg = 8 and creasePropagateAngleDeg = 8 (5° < 8°), should NOT propagate to face 2!
      const mockCustomBrushNoProp = {
        id: 'c2',
        name: 'No Propagate',
        color: '#ff0000',
        selection: {
          normalConeAngleMinDeg: 0,
          normalConeAngleMaxDeg: 90,
          overhangSlopeMinDeg: 0,
          overhangSlopeMaxDeg: 90,
          curvatureMin: 0,
          curvatureMax: 1,
          dihedralAngleToleranceDeg: 45,
          creaseSeedAngleDeg: 8,
          creasePropagateAngleDeg: 8,
          ridgeAlignmentTolerance: 0.3,
        },
        operations: [],
      };

      const resNoProp = proposeRegionOnClient(
        creaseAdjacencyMap,
        0,
        'Ridge',
        identityMatrix,
        4.0,
        mockCustomBrushNoProp
      );
      assert.ok(resNoProp.includes(0));
      assert.ok(resNoProp.includes(1));
      assert.ok(!resNoProp.includes(2), 'Should fail to propagate to face 2 because 5 deg crease < 8 deg propagate threshold');
    });

    it('should respect custom zHeightEnvelopeToleranceMm in Ring walks', () => {
      // 3 faces at different heights
      // Face 0: (0,0,0)
      // Face 1: (1,0,0.5)
      // Face 2: (2,0,1.2)
      const ringAdjacencyMap: ClientAdjacencyMap = {
        faceCount: 3,
        faceNormals: Array.from({ length: 3 }, () => new THREE.Vector3(0, 0, -1)),
        faceCentroids: [
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(1, 0, 0.5),
          new THREE.Vector3(2, 0, 1.2),
        ],
        faceZBounds: [
          { min: -0.1, max: 0.1 },
          { min: 0.4, max: 0.6 },
          { min: 1.1, max: 1.3 },
        ],
        faceToFaces: [
          [1],    // 0
          [0, 2], // 1
          [1],    // 2
        ],
      };

      // Case 1: default ring (uses ±1.0mm envelope relative to seed at Z=0)
      // Seed Z=0. Face 1 has Z=0.5 (<= 1.0, so valid). Face 2 has Z=1.2 (> 1.0, so invalid).
      // So default should return [0, 1]
      const resDefault = proposeRegionOnClient(
        ringAdjacencyMap,
        0,
        'Ring',
        identityMatrix
      );
      assert.strictEqual(resDefault.length, 2);
      assert.ok(resDefault.includes(0));
      assert.ok(resDefault.includes(1));
      assert.ok(!resDefault.includes(2));

      // Case 2: Custom brush with zHeightEnvelopeToleranceMm = 0.3
      // Seed Z=0. Face 1 has Z=0.5 (> 0.3, so invalid).
      // So custom should return only [0]
      const mockCustomRingBrush = {
        id: 'c3',
        name: 'Narrow Ring',
        color: '#00ff00',
        selection: {
          normalConeAngleMinDeg: 0,
          normalConeAngleMaxDeg: 90,
          overhangSlopeMinDeg: 0,
          overhangSlopeMaxDeg: 90,
          curvatureMin: 0,
          curvatureMax: 1,
          dihedralAngleToleranceDeg: 45,
          zHeightEnvelopeToleranceMm: 0.3,
        },
        operations: [],
      };

      const resCustom = proposeRegionOnClient(
        ringAdjacencyMap,
        0,
        'Ring',
        identityMatrix,
        4.0,
        mockCustomRingBrush
      );
      assert.strictEqual(resCustom.length, 1);
      assert.ok(resCustom.includes(0));
      assert.ok(!resCustom.includes(1), 'Face 1 (Z=0.5) should be filtered out with ±0.3 tolerance');
    });
  });

  describe('Marker Brush Shapes, Fence Blocking, and Collision Strategies', () => {
    it('should correctly project rotated Line footprint shapes', () => {
      // Line tip: R = 1.5, rotation = 90 deg.
      // Unrotated line is aligned along U-axis (Y-axis).
      // At 90 deg rotation, it aligns along V-axis (X-axis), extending to faces 3, 5,
      // and is narrow along U-axis, excluding faces 1, 7.
      const result = proposeRegionOnClient(
        mockAdjacencyMap,
        4, // Seed 4
        'Marker',
        identityMatrix,
        1.5,
        undefined,
        {
          radiusMm: 1.5,
          shape: 'line',
          rotationDeg: 90,
          collisionMode: 'fence',
        }
      );

      assert.ok(result.includes(4));
      assert.ok(result.includes(3));
      assert.ok(result.includes(5));
      assert.ok(!result.includes(1), 'Face 1 should be excluded by Line width limit');
      assert.ok(!result.includes(7), 'Face 7 should be excluded by Line width limit');
    });

    it('should correctly project Rectangle 2:1 footprint shapes', () => {
      // Rectangle tip: R = 1.5, rotation = 0.
      // Unrotated rectangle has length along U-axis (Y-axis), so it should include faces 1, 7.
      // Height limit (V-axis/X-axis) is 0.75, so X-axis faces (3, 5) at distance 1.0 are excluded.
      const result = proposeRegionOnClient(
        mockAdjacencyMap,
        4,
        'Marker',
        identityMatrix,
        1.5,
        undefined,
        {
          radiusMm: 1.5,
          shape: 'rectangle',
          rotationDeg: 0,
          collisionMode: 'fence',
        }
      );

      assert.ok(result.includes(4));
      assert.ok(result.includes(1));
      assert.ok(result.includes(7));
      assert.ok(!result.includes(3), 'Face 3 should be excluded by rectangle 2:1 height limit');
      assert.ok(!result.includes(5), 'Face 5 should be excluded by rectangle 2:1 height limit');
    });

    it('should block Dijkstra propagation at occupied boundaries in Fence Mode', () => {
      // In Fence mode, if face 1 is occupied, the walk should not propagate to or past face 1.
      const occupied = new Set([1]);
      const result = proposeRegionOnClient(
        mockAdjacencyMap,
        4,
        'Marker',
        identityMatrix,
        1.5,
        undefined,
        {
          radiusMm: 1.5,
          shape: 'circle',
          rotationDeg: 0,
          collisionMode: 'fence',
        },
        occupied
      );

      assert.ok(result.includes(4));
      assert.ok(result.includes(3));
      assert.ok(result.includes(5));
      assert.ok(result.includes(7));
      assert.ok(!result.includes(1), 'Face 1 should be blocked because it is occupied in Fence mode');
    });

    it('should erode occupied triangles from other ROIs in Push/Erode Mode', () => {
      // Setup region A with faces [1, 2]
      const roiA: ROIRegion = {
        id: 'roi-a',
        brushType: 'Marker',
        seedTriangleId: 1,
        triangleIds: new Set([1, 2]),
        color: '#4A90E2',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      supportPainterStore.clearAll();
      supportPainterStore.setClientAdjacencyMap(mockAdjacencyMap);
      const regionsMap = new Map<string, ROIRegion>();
      regionsMap.set(roiA.id, roiA);
      supportPainterStore.restoreRegions(regionsMap);

      // Now propose a Marker stroke over faces [0, 1] and commit it as region B in 'push' collision mode
      supportPainterStore.setProposedTriangleIds([0, 1]);
      supportPainterStore.setMarkerCollisionMode('push');
      
      const roiBId = supportPainterStore.commitRegion({
        seedTriangleId: 0,
        brushType: 'Marker',
      });

      const snap = supportPainterStore.getSnapshot();
      // Region A should be eroded, losing face 1, so it only has face 2
      const updatedRoiA = snap.regions.get('roi-a')!;
      assert.ok(updatedRoiA);
      assert.strictEqual(updatedRoiA.triangleIds.size, 1);
      assert.ok(updatedRoiA.triangleIds.has(2));
      assert.ok(!updatedRoiA.triangleIds.has(1), 'Face 1 should be eroded from region A');

      // Region B should successfully hold faces [0, 1]
      const roiB = snap.regions.get(roiBId)!;
      assert.ok(roiB);
      assert.strictEqual(roiB.triangleIds.size, 2);
      assert.ok(roiB.triangleIds.has(0));
      assert.ok(roiB.triangleIds.has(1));
    });

    it('should merge touched ROIs and the stroke into a single ROI in Merge Mode', () => {
      // Setup region A with faces [1]
      const roiA: ROIRegion = {
        id: 'roi-a',
        brushType: 'Marker',
        seedTriangleId: 1,
        triangleIds: new Set([1]),
        color: '#4A90E2',
        proposedOnly: false,
        createdAt: Date.now(),
      };

      supportPainterStore.clearAll();
      supportPainterStore.setClientAdjacencyMap(mockAdjacencyMap);
      const regionsMap = new Map<string, ROIRegion>();
      regionsMap.set(roiA.id, roiA);
      supportPainterStore.restoreRegions(regionsMap);

      // Propose a Marker stroke over face [4] (which touches face 1 via adjacency)
      // And touches/intersects face 1 (let's cover faces [1, 4])
      supportPainterStore.setProposedTriangleIds([1, 4]);
      supportPainterStore.setMarkerCollisionMode('merge');

      const roiBId = supportPainterStore.commitRegion({
        seedTriangleId: 4,
        brushType: 'Marker',
      });

      const snap = supportPainterStore.getSnapshot();
      // Region A should be merged (deleted), and the new region B should contain the union [1, 4]
      assert.ok(!snap.regions.has('roi-a'), 'Region A should be deleted because it was merged');
      
      const roiB = snap.regions.get(roiBId)!;
      assert.ok(roiB);
      assert.strictEqual(roiB.triangleIds.size, 2);
      assert.ok(roiB.triangleIds.has(1));
      assert.ok(roiB.triangleIds.has(4));
    });
  });
});
