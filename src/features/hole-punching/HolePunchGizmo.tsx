"use client";

import React, { useRef, useCallback, useLayoutEffect } from 'react';
import * as THREE from 'three';
import { ScreenSpaceGizmo } from '@/components/gizmo/ScreenSpaceGizmo';

const UP = new THREE.Vector3(0, 1, 0);

interface HolePunchGizmoProps {
  /** The selected hole punch placement to show the gizmo for */
  placement: {
    id: string;
    worldPoint: THREE.Vector3;
    worldNormal: THREE.Vector3;
  };
  /** Called when the gizmo starts being dragged */
  onMoveStart?: () => void;
  /** Called when the gizmo is dragged. Delta is in world space. */
  onMove?: (delta: THREE.Vector3) => void;
  /** Called when the gizmo drag ends */
  onMoveEnd?: () => void;
}

/**
 * HolePunchGizmo - A positioning gizmo for hole punch cylinders
 *
 * Renders a ScreenSpaceGizmo at the cylinder's position, oriented
 * along its normal (Y axis matches the cylinder axis). The center XY
 * drag circle is removed so only the axis arrows remain for precise
 * positioning. When using the gizmo, snapping to surface normals is
 * disabled for that cylinder.
 *
 * The gizmo is rotated so its Y axis aligns with the cylinder normal.
 * The TransformGizmo now propagates its rotation into GizmoMove's
 * worldAxisDir prop, so the drag delta is computed along the visual
 * arrow direction — fully decoupled from world axes.
 */
export function HolePunchGizmo({
  placement,
  onMoveStart,
  onMove,
  onMoveEnd,
}: HolePunchGizmoProps) {
  const gizmoTargetRef = useRef<THREE.Group>(null);
  // Track whether we're mid-drag so the sync effect skips during drag.
  const isDraggingRef = useRef(false);

  // Compute the gizmo rotation so Y aligns with the cylinder normal.
  const gizmoEuler = React.useMemo((): THREE.Euler => {
    const normal = placement.worldNormal.clone();
    if (normal.lengthSq() <= 1e-10) {
      normal.set(0, 0, 1);
    } else {
      normal.normalize();
    }

    const q = new THREE.Quaternion();
    q.setFromUnitVectors(UP, normal);
    return new THREE.Euler().setFromQuaternion(q);
  }, [placement.worldNormal]);

  const handleMoveStart = useCallback(() => {
    isDraggingRef.current = true;
    onMoveStart?.();
  }, [onMoveStart]);

  const handleMove = useCallback((delta: THREE.Vector3) => {
    // Compute the new position directly from the current React state
    // (placement.worldPoint) plus the delta. This is the same formula
    // used by page.tsx, so the gizmo visual and the cylinder visual
    // always agree — no accumulator drift.
    const newPos = new THREE.Vector3(
      placement.worldPoint.x + delta.x,
      placement.worldPoint.y + delta.y,
      placement.worldPoint.z + delta.z,
    );

    // Sync the target group position so the ScreenSpaceGizmo follows.
    if (gizmoTargetRef.current) {
      gizmoTargetRef.current.position.copy(newPos);
    }

    onMove?.(delta);
  }, [placement.worldPoint, onMove]);

  const handleMoveEnd = useCallback(() => {
    isDraggingRef.current = false;
    onMoveEnd?.();
  }, [onMoveEnd]);

  // Sync gizmo group position to the placement position when not dragging.
  useLayoutEffect(() => {
    if (!gizmoTargetRef.current) return;
    if (isDraggingRef.current) return;
    gizmoTargetRef.current.position.copy(placement.worldPoint);
  }, [placement.worldPoint.x, placement.worldPoint.y, placement.worldPoint.z]);

  return (
    <>
      <group ref={gizmoTargetRef} />
      <ScreenSpaceGizmo
        meshRef={gizmoTargetRef as React.RefObject<THREE.Group>}
        position={[placement.worldPoint.x, placement.worldPoint.y, placement.worldPoint.z]}
        rotation={gizmoEuler}
        enableMove
        enableRotate={false}
        enableScale={false}
        showCenter={false}
        onMoveStart={handleMoveStart}
        onMove={handleMove}
        onMoveEnd={handleMoveEnd}
        scaleFactor={0.025}
        handleScale={2.5}
      />
    </>
  );
}
