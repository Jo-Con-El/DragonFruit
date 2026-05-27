import {
  type ROIRegion,
  type VoxlROIExtension,
} from './supportPainterTypes';

/**
 * Converts in-memory ROIRegion map into a JSON-safe VoxlROIExtension object.
 */
export function serializeROIsForVoxl(
  regions: Map<string, ROIRegion>,
  modelId: string
): VoxlROIExtension {
  const list = Array.from(regions.values()).map((r) => ({
    id: r.id,
    brushType: r.brushType,
    seedTriangleId: r.seedTriangleId,
    triangleIds: Array.from(r.triangleIds),
    color: r.color,
    createdAt: r.createdAt,
  }));

  return {
    kind: 'support-painter-rois',
    version: 1,
    modelId,
    regions: list,
  };
}

/**
 * Converts VoxlROIExtension back into a Map<string, ROIRegion>.
 */
export function deserializeROIsFromVoxl(
  ext: VoxlROIExtension
): Map<string, ROIRegion> {
  const map = new Map<string, ROIRegion>();
  for (const r of ext.regions) {
    map.set(r.id, {
      id: r.id,
      brushType: r.brushType,
      seedTriangleId: r.seedTriangleId,
      triangleIds: new Set(r.triangleIds),
      color: r.color,
      proposedOnly: false,
      createdAt: r.createdAt,
    });
  }
  return map;
}

/**
 * Type guard to validate whether an unknown value is a valid VoxlROIExtension.
 */
export function isVoxlROIExtension(v: unknown): v is VoxlROIExtension {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as Partial<VoxlROIExtension>;
  return (
    candidate.kind === 'support-painter-rois' &&
    candidate.version === 1 &&
    typeof candidate.modelId === 'string' &&
    Array.isArray(candidate.regions)
  );
}
