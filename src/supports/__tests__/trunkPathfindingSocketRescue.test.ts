import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildStraightSocketRescueCandidates,
    findStraightSocketRescueCandidate,
} from '../PlacementLogic/Pathfinding/SmartPlacementV2';
import type { SDFCache } from '../PlacementLogic/Pathfinding/SDFCache';

function makeOpenSdf(overrides?: Partial<Pick<SDFCache, 'distanceAt' | 'isBlocked' | 'segmentBlocked'>>): SDFCache {
    return {
        cellSize: 0.5,
        distanceAt: () => Infinity,
        isBlocked: () => false,
        segmentBlocked: () => false,
        ...overrides,
    } as SDFCache;
}

test('buildStraightSocketRescueCandidates expands outward from the blocked socket', () => {
    const candidates = buildStraightSocketRescueCandidates({
        socketPos: { x: 0, y: 0, z: 10 },
        maxTotalLateralMm: 2,
    });

    assert.deepEqual(candidates[0], { x: 0, y: 0, z: 10 });
    assert.ok(candidates.some((candidate) => Math.abs(candidate.x - 1) < 0.000001 && Math.abs(candidate.y) < 0.000001));
});

test('findStraightSocketRescueCandidate finds a nearby clear straight support when the default socket column is blocked', () => {
    const sdf = makeOpenSdf({
        segmentBlocked: (ax: number, _ay: number, _az: number, bx: number) => Math.abs(ax) < 0.000001 && Math.abs(bx) < 0.000001,
    });

    const rescued = findStraightSocketRescueCandidate({
        socketPos: { x: 0, y: 0, z: 10 },
        rootTopZ: 2,
        maxTotalLateralMm: 2,
        gridEnabled: false,
        spacingMm: 4,
        maxNearestNodeSearchRings: 1,
        sdf,
        diskHeight: 1,
        coneHeight: 1,
        rootsRadius: 1.5,
        shaftRadius: 0.75,
        clearance: 1,
    });

    assert.ok(rescued);
    assert.notDeepEqual(rescued?.socketPos, { x: 0, y: 0, z: 10 });
    assert.equal(rescued?.base.basePos.z, 0);
});