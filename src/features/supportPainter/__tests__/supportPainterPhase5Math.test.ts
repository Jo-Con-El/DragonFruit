import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { samplePoissonDiscWarped, type WeldedTriangle } from '../supportScriptingEngine';
import { type ROIRegion, type CustomSupportOperation } from '../supportPainterTypes';

describe('Support Painter Phase 5 - Warp-Space Infill Z-Density Solver', () => {
  // Setup a sloped region of two triangles:
  // T1: (0,0,0) -> (20,0,20) -> (0,20,20)  [Z goes from 0 to 20]
  // T2: (20,20,40) -> (0,20,20) -> (20,0,20) [Z goes from 20 to 40]
  const t1: WeldedTriangle = {
    id: 0,
    v0: new THREE.Vector3(0, 0, 0),
    v1: new THREE.Vector3(20, 0, 20),
    v2: new THREE.Vector3(0, 20, 20),
    idx0: 0,
    idx1: 1,
    idx2: 2,
    normal: new THREE.Vector3(1, 0, -1).normalize(),
    centroid: new THREE.Vector3(20/3, 20/3, 40/3),
  };

  const t2: WeldedTriangle = {
    id: 1,
    v0: new THREE.Vector3(20, 20, 40),
    v1: new THREE.Vector3(0, 20, 20),
    v2: new THREE.Vector3(20, 0, 20),
    idx0: 3,
    idx1: 2,
    idx2: 1,
    normal: new THREE.Vector3(1, 0, -1).normalize(),
    centroid: new THREE.Vector3(40/3, 40/3, 80/3),
  };

  const trianglesList = [t1, t2];

  const region: ROIRegion = {
    id: 'test-infill-roi',
    brushType: 'ManualCircle',
    seedTriangleId: 0,
    triangleIds: new Set([0, 1]),
    color: '#06B6D4',
    proposedOnly: false,
    createdAt: Date.now(),
  };

  // Note: in the scripting engine, calculateZHeightDensitySpacing returns:
  // - baseSpacingMm at Z=minima (bottom)
  // - endSpacingMm at Z=maxima (top)
  // To get dense supports at the bottom and sparse at the top, we must configure:
  // baseSpacingMm = 2.0 (dense) and endSpacingMm = 8.0 (sparse).
  const baseOp: CustomSupportOperation = {
    type: 'infill',
    enabled: true,
    enableZHeightDensity: true,
    minimaStartInterval: 0,
    minimaEndInterval: 100,
    endSpacingMm: 8.0, // Sparse spacing at top (Z=40)
    zFactorCurve: 'linear',
    suppression: {
      enabled: false,
      distanceMm: 4.0,
      suppressAgainst: [],
    },
    spacing: {
      baseSpacingMm: 2.0, // Dense spacing at bottom (Z=0)
      infillPattern: 'PoissonDisc',
    },
  };

  it('should generate Poisson Disc candidates under Z-density constraints', () => {
    const results = samplePoissonDiscWarped(
      region,
      0,   // minZ
      40,  // maxZ
      baseOp,
      trianglesList,
      1.0  // opTrunkWidth
    );

    assert.ok(results.length > 0, 'Should generate candidate points');
    
    for (const pt of results) {
      assert.ok(pt.pos.x >= 0 && pt.pos.x <= 20);
      assert.ok(pt.pos.y >= 0 && pt.pos.y <= 20);
      const expectedZ = pt.pos.x + pt.pos.y;
      assert.ok(Math.abs(pt.pos.z - expectedZ) < 1e-3, `Point ${pt.pos.toArray()} should lie on Z=x+y surface`);
    }
  });

  it('should enforce variable spacing: denser at lower Z and sparser at higher Z', () => {
    const results = samplePoissonDiscWarped(
      region,
      0,
      40,
      baseOp,
      trianglesList,
      1.0
    );

    const lowerPoints = results.filter(pt => pt.pos.z <= 20);
    const upperPoints = results.filter(pt => pt.pos.z > 20);

    assert.ok(lowerPoints.length > upperPoints.length, `Lower Z regions (${lowerPoints.length} pts) must contain more points than upper Z (${upperPoints.length} pts) due to higher density scaling`);
  });

  it('should satisfy local Poisson disc distance constraints in unwarped space', () => {
    const results = samplePoissonDiscWarped(
      region,
      0,
      40,
      baseOp,
      trianglesList,
      1.0
    );

    // Expected spacing: starts at baseSpacingMm (2.0) and goes to endSpacingMm (8.0)
    const getExpectedSpacing = (z: number) => {
      const t = Math.min(1.0, Math.max(0.0, z / 40.0));
      return 2.0 + t * (8.0 - 2.0);
    };

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const ptA = results[i].pos;
        const ptB = results[j].pos;
        const dist = ptA.distanceTo(ptB);

        const spacingA = getExpectedSpacing(ptA.z);
        const spacingB = getExpectedSpacing(ptB.z);
        // Allowing a tiny numerical projection tolerance of 0.85 for 3D triangle mappings
        const minAllowed = Math.min(spacingA, spacingB) * 0.85;

        assert.ok(
          dist >= minAllowed,
          `Points too close: ${ptA.toArray()} and ${ptB.toArray()} distance is ${dist}, allowed minimum is ${minAllowed}`
        );
      }
    }
  });

  it('should fallback to identity warping (constant spacing) if Z-density is disabled', () => {
    const disabledOp = {
      ...baseOp,
      enableZHeightDensity: false,
      spacing: {
        ...baseOp.spacing,
        baseSpacingMm: 8.0, // Constant 8.0mm spacing
      }
    };

    const results = samplePoissonDiscWarped(
      region,
      0,
      40,
      disabledOp,
      trianglesList,
      1.0
    );

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const ptA = results[i].pos;
        const ptB = results[j].pos;
        const dist = ptA.distanceTo(ptB);
        assert.ok(
          dist >= 8.0 * 0.85,
          `Points too close with Z-density disabled: distance is ${dist}, limit is 6.8mm`
        );
      }
    }
  });
});
