import { Vec3 } from '../../types';
import { SDFCache } from './SDFCache';
import { resolveCommittedBaseCandidate } from './SmartPlacementV2';

export interface GradientFlowRouterOptions {
    clearance: number;
    gridEnabled: boolean;
    spacingMm: number;
    diskHeight: number;
    coneHeight: number;
    rootsRadius: number;
    shaftRadius: number;
    buildNearestCandidateNodeKeys?: (preferredKey: string, maxRings: number) => string[];
}

export interface GradientFlowResult {
    reached: boolean;
    path: Vec3[];
    basePos: Vec3;
    snappedNodeKey: string | null;
    error?: 'COLLISION_WITH_MODEL' | 'STAGNATED' | 'OUT_OF_BOUNDS';
}

export function runGradientFlowRouter(
    sdf: SDFCache,
    socketPos: Vec3,
    rootTopZ: number,
    opts: GradientFlowRouterOptions
): GradientFlowResult {
    const clearance = opts.clearance;
    const stepMm = 0.5;
    const eps = 0.25;
    const maxIter = 1000;

    const path: Vec3[] = [{ ...socketPos }];
    let curr = { ...socketPos };
    let reached = false;

    // Weight parameters: below safety we push hard; above clearance we drop vertical
    const dSafety = clearance;
    const dClearance = clearance * 1.5;

    for (let iter = 0; iter < maxIter; iter++) {
        if (curr.z <= rootTopZ) {
            reached = true;
            break;
        }

        const d = sdf.distanceAtTrilinear(curr.x, curr.y, curr.z);
        if (d !== Infinity && d < -0.01) {
            // Inside the mesh
            return {
                reached: false,
                path,
                basePos: { x: curr.x, y: curr.y, z: 0 },
                snappedNodeKey: null,
                error: 'COLLISION_WITH_MODEL',
            };
        }

        // Calculate gradient using central differences on distanceAtTrilinear
        let gx = 0;
        let gy = 0;
        let gz = 0;

        if (d !== Infinity) {
            const dxp = sdf.distanceAtTrilinear(curr.x + eps, curr.y, curr.z);
            const dxn = sdf.distanceAtTrilinear(curr.x - eps, curr.y, curr.z);
            const dyp = sdf.distanceAtTrilinear(curr.x, curr.y + eps, curr.z);
            const dyn = sdf.distanceAtTrilinear(curr.x, curr.y - eps, curr.z);
            const dzp = sdf.distanceAtTrilinear(curr.x, curr.y, curr.z + eps);
            const dzn = sdf.distanceAtTrilinear(curr.x, curr.y, curr.z - eps);

            if (dxp !== Infinity && dxn !== Infinity) gx = (dxp - dxn) / (2 * eps);
            if (dyp !== Infinity && dyn !== Infinity) gy = (dyp - dyn) / (2 * eps);
            if (dzp !== Infinity && dzn !== Infinity) gz = (dzp - dzn) / (2 * eps);
        }

        const gradMag = Math.sqrt(gx * gx + gy * gy + gz * gz);
        const gradVec = gradMag > 0.0001
            ? { x: gx / gradMag, y: gy / gradMag, z: gz / gradMag }
            : { x: 0, y: 0, z: 0 };

        // Determine blend weight
        let w = 0;
        if (d !== Infinity) {
            if (d < dSafety) {
                w = 1.0;
            } else if (d >= dClearance) {
                w = 0.0;
            } else {
                w = (dClearance - d) / (dClearance - dSafety);
            }
        }

        // Gravity vector [0, 0, -1]
        const gravVec = { x: 0, y: 0, z: -1 };

        // Blend directions: moving away from mesh means following gradient (+gradVec)
        let dx = (1 - w) * gravVec.x + w * gradVec.x;
        let dy = (1 - w) * gravVec.y + w * gradVec.y;
        let dz = (1 - w) * gravVec.z + w * gradVec.z;

        const blendMag = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const stepDir = blendMag > 0.0001
            ? { x: dx / blendMag, y: dy / blendMag, z: dz / blendMag }
            : { x: 0, y: 0, z: -1 };

        // Ensure we always make downward progress
        const stepZ = stepDir.z < -0.01 ? stepDir.z : -0.1;
        const scale = stepMm / Math.sqrt(stepDir.x * stepDir.x + stepDir.y * stepDir.y + stepZ * stepZ);

        const next = {
            x: curr.x + stepDir.x * scale,
            y: curr.y + stepDir.y * scale,
            z: curr.z + stepZ * scale,
        };

        // Clamp Z to guarantee progress
        if (next.z >= curr.z) {
            next.z = curr.z - 0.01;
        }

        // Verify that the step segment does not collide with the model
        if (sdf.segmentBlocked(curr.x, curr.y, curr.z, next.x, next.y, next.z, clearance)) {
            return {
                reached: false,
                path,
                basePos: { x: curr.x, y: curr.y, z: 0 },
                snappedNodeKey: null,
                error: 'COLLISION_WITH_MODEL',
            };
        }

        curr = next;
        path.push({ ...curr });
    }

    if (!reached) {
        return {
            reached: false,
            path,
            basePos: { x: curr.x, y: curr.y, z: 0 },
            snappedNodeKey: null,
            error: 'STAGNATED',
        };
    }

    // Force clamp endpoint to rootTopZ
    const endPoint = path[path.length - 1];
    endPoint.z = rootTopZ;

    // Snapping Logic
    let basePos = { x: endPoint.x, y: endPoint.y, z: 0 };
    let snappedNodeKey: string | null = null;

    const lastSegmentStart = path.length > 1 ? path[path.length - 2] : socketPos;

    const committedBase = resolveCommittedBaseCandidate({
        preferredBottomPos: { x: endPoint.x, y: endPoint.y, z: 0 },
        lastSegmentStart,
        rootTopZ,
        gridEnabled: opts.gridEnabled,
        spacingMm: opts.spacingMm,
        maxNearestNodeSearchRings: 12,
        sdf,
        diskHeight: opts.diskHeight,
        coneHeight: opts.coneHeight,
        rootsRadius: opts.rootsRadius,
        shaftRadius: opts.shaftRadius,
        clearance,
        buildNearestCandidateNodeKeys: opts.buildNearestCandidateNodeKeys,
    });

    if (committedBase) {
        basePos = committedBase.basePos;
        snappedNodeKey = committedBase.nodeKey;
    } else {
        if (opts.gridEnabled) {
            return {
                reached: true,
                path,
                basePos,
                snappedNodeKey: null,
                error: 'COLLISION_WITH_MODEL',
            };
        }
    }

    return {
        reached: true,
        path,
        basePos,
        snappedNodeKey,
    };
}
