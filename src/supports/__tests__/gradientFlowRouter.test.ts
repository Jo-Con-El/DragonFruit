import assert from 'node:assert/strict';
import test from 'node:test';

import { runGradientFlowRouter } from '../PlacementLogic/Pathfinding/GradientFlowRouter';
import type { SDFCache } from '../PlacementLogic/Pathfinding/SDFCache';

function makeMockSdf(overrides?: Partial<Pick<SDFCache, 'distanceAt' | 'distanceAtTrilinear' | 'isBlocked' | 'segmentBlocked'>>): SDFCache {
    return {
        cellSize: 0.5,
        distanceAt: () => Infinity,
        distanceAtTrilinear: () => Infinity,
        isBlocked: () => false,
        segmentBlocked: () => false,
        ...overrides,
    } as SDFCache;
}

test('runGradientFlowRouter descends straight down in free space (no SDF collisions)', () => {
    const sdf = makeMockSdf();

    const result = runGradientFlowRouter(sdf, { x: 5, y: 5, z: 20 }, 2, {
        clearance: 0.75,
        gridEnabled: false,
        spacingMm: 4,
        diskHeight: 1,
        coneHeight: 1,
        rootsRadius: 1.5,
        shaftRadius: 0.75,
    });

    assert.equal(result.reached, true);
    assert.ok(result.path.length > 0);
    
    // In free space, it should march straight down vertically
    const lastPoint = result.path[result.path.length - 1];
    assert.equal(lastPoint.z, 2);
    assert.equal(lastPoint.x, 5);
    assert.equal(lastPoint.y, 5);

    // Grid-disabled base snap should be directly below the exit point
    assert.equal(result.basePos.x, 5);
    assert.equal(result.basePos.y, 5);
    assert.equal(result.basePos.z, 0);
    assert.equal(result.snappedNodeKey, null);
});

test('runGradientFlowRouter bends away from an obstacle based on SDF gradient', () => {
    // Model an obstacle on the left (x < 3) close to the path
    const sdf = makeMockSdf({
        distanceAtTrilinear: (x, y, z) => {
            // Distance increases as x moves right (away from x = 3)
            return x - 3;
        },
        segmentBlocked: () => false,
    });

    const result = runGradientFlowRouter(sdf, { x: 3.5, y: 5, z: 20 }, 2, {
        clearance: 1.0,
        gridEnabled: false,
        spacingMm: 4,
        diskHeight: 1,
        coneHeight: 1,
        rootsRadius: 1.5,
        shaftRadius: 0.75,
    });

    assert.equal(result.reached, true);
    
    // Path should shift to the right (+x) due to the gradient pushing it away from x = 3
    const lastPoint = result.path[result.path.length - 1];
    assert.ok(lastPoint.x > 3.5, `Expected path to shift right, got x=${lastPoint.x}`);
});

test('runGradientFlowRouter snaps to grid when gridEnabled is true', () => {
    const sdf = makeMockSdf();

    // Node grid centered at multiples of 4mm
    const result = runGradientFlowRouter(sdf, { x: 5, y: 5, z: 20 }, 2, {
        clearance: 0.75,
        gridEnabled: true,
        spacingMm: 4,
        diskHeight: 1,
        coneHeight: 1,
        rootsRadius: 1.5,
        shaftRadius: 0.75,
        buildNearestCandidateNodeKeys: (preferredKey) => [preferredKey],
    });

    assert.equal(result.reached, true);
    
    // (5, 5) snapped to 4mm grid is (4, 4) or (4, 8) or (8, 4) depending on snapped key representation
    // Let's verify it snapped and returned a snappedNodeKey
    assert.ok(result.snappedNodeKey !== null);
    assert.ok(result.basePos.x === 4 || result.basePos.x === 8);
    assert.ok(result.basePos.y === 4 || result.basePos.y === 8);
});

test('runGradientFlowRouter returns collision error when path intersects the model', () => {
    const sdf = makeMockSdf({
        segmentBlocked: () => true, // All segments are blocked
    });

    const result = runGradientFlowRouter(sdf, { x: 5, y: 5, z: 20 }, 2, {
        clearance: 0.75,
        gridEnabled: false,
        spacingMm: 4,
        diskHeight: 1,
        coneHeight: 1,
        rootsRadius: 1.5,
        shaftRadius: 0.75,
    });

    assert.equal(result.reached, false);
    assert.equal(result.error, 'COLLISION_WITH_MODEL');
});
