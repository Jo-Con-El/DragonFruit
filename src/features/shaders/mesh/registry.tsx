import type * as THREE from 'three';
import type { MatcapVariant, MeshShaderType } from './types';
import { SoftClayMaterial } from './softClay';
import { FlatUnlitMaterial } from './flatUnlit';
import { MatcapMaterial } from './matcap';
import { ToonMaterial } from './toon';
import { NormalDebugMaterial } from './normalDebug';
import { WireframeMaterial } from './wireframe';
import { XrayMaterial } from './xray';
import { OverhangHeatmapMaterial } from './overhangHeatmap';
import type { SupportCoverageTipData, IslandMarkerData } from './softClay';
export type { SupportCoverageTipData, IslandMarkerData } from './softClay';

export function MeshShaderMaterial({
  shaderType,
  isSelected,
  isHovered = false,
  useVertexColors = true,
  hoverTintColor,
  selectedTintColor,
  hoverTintStrength,
  selectedTintStrength,
  meshColor,
  materialRoughness,
  clippingPlanes,
  xrayOpacity,
  heatmapBlend,
  heatmapContrast,
  heatmapColors,
  matcapVariant,
  flatUseVertexColors,
  toonSteps,
  supportCoverageTips,
  supportCoverageColor,
  supportCoverageIntensity,
  islandMarkers,
  showIslands,
  islandColor,
  islandIntensity,
  islandRadiusFactor,
  islandColumnHeight,
  showOverhang,
  overhangColor,
  overhangAngleDeg,
  overhangIntensity,
  overhangProximityMm,
}: {
  shaderType: MeshShaderType;
  isSelected: boolean;
  isHovered?: boolean;
  useVertexColors?: boolean;
  hoverTintColor?: string;
  selectedTintColor?: string;
  hoverTintStrength?: number;
  selectedTintStrength?: number;
  meshColor?: string;
  materialRoughness?: number;
  clippingPlanes: THREE.Plane[];
  xrayOpacity?: number;
  heatmapBlend?: number;
  heatmapContrast?: number;
  heatmapColors?: string[];
  matcapVariant?: MatcapVariant;
  flatUseVertexColors?: boolean;
  toonSteps?: number;
  // Support-coverage halo data — consumed by SoftClayMaterial's shader
  // patch. Other shader variants (matcap, toon, xray, etc.) ignore it
  // for now; extend their patches similarly to enable the halo there.
  supportCoverageTips?: SupportCoverageTipData;
  supportCoverageColor?: string;
  supportCoverageIntensity?: number;
  islandMarkers?: IslandMarkerData;
  showIslands?: boolean;
  islandColor?: string;
  islandIntensity?: number;
  islandRadiusFactor?: number;
  islandColumnHeight?: number;
  showOverhang?: boolean;
  overhangColor?: string;
  overhangAngleDeg?: number;
  overhangIntensity?: number;
  overhangProximityMm?: number;
}) {
  switch (shaderType) {
    case 'flat_unlit':
      return (
        <FlatUnlitMaterial
          isSelected={isSelected}
          isHovered={isHovered}
          hoverTintColor={hoverTintColor}
          selectedTintColor={selectedTintColor}
          hoverTintStrength={hoverTintStrength}
          selectedTintStrength={selectedTintStrength}
          useVertexColors={useVertexColors && (flatUseVertexColors ?? true)}
          meshColor={meshColor}
          clippingPlanes={clippingPlanes}
        />
      );

    case 'matcap':
      return (
        <MatcapMaterial
          isSelected={isSelected}
          isHovered={isHovered}
          hoverTintColor={hoverTintColor}
          selectedTintColor={selectedTintColor}
          hoverTintStrength={hoverTintStrength}
          selectedTintStrength={selectedTintStrength}
          useVertexColors={useVertexColors}
          meshColor={meshColor}
          variant={matcapVariant}
          clippingPlanes={clippingPlanes}
        />
      );

    case 'toon':
      return (
        <ToonMaterial
          isSelected={isSelected}
          isHovered={isHovered}
          hoverTintColor={hoverTintColor}
          selectedTintColor={selectedTintColor}
          hoverTintStrength={hoverTintStrength}
          selectedTintStrength={selectedTintStrength}
          useVertexColors={useVertexColors}
          meshColor={meshColor}
          toonSteps={toonSteps}
          clippingPlanes={clippingPlanes}
        />
      );

    case 'normal_debug':
      return <NormalDebugMaterial clippingPlanes={clippingPlanes} />;

    case 'wireframe':
      return (
        <WireframeMaterial
          isSelected={isSelected}
          isHovered={isHovered}
          meshColor={meshColor}
          hoverTintColor={hoverTintColor}
          selectedTintColor={selectedTintColor}
          hoverTintStrength={hoverTintStrength}
          selectedTintStrength={selectedTintStrength}
          clippingPlanes={clippingPlanes}
        />
      );

    case 'xray':
      return (
        <XrayMaterial
          isSelected={isSelected}
          isHovered={isHovered}
          hoverTintColor={hoverTintColor}
          selectedTintColor={selectedTintColor}
          hoverTintStrength={hoverTintStrength}
          selectedTintStrength={selectedTintStrength}
          useVertexColors={useVertexColors}
          meshColor={meshColor}
          materialRoughness={materialRoughness}
          clippingPlanes={clippingPlanes}
          opacity={xrayOpacity}
        />
      );

    case 'overhang_heatmap':
      return (
        <OverhangHeatmapMaterial
          isSelected={isSelected}
          isHovered={isHovered}
          hoverTintColor={hoverTintColor}
          selectedTintColor={selectedTintColor}
          hoverTintStrength={hoverTintStrength}
          selectedTintStrength={selectedTintStrength}
          useVertexColors={useVertexColors}
          meshColor={meshColor}
          materialRoughness={materialRoughness}
          clippingPlanes={clippingPlanes}
          heatmapBlend={heatmapBlend}
          heatmapContrast={heatmapContrast}
          heatmapColors={heatmapColors}
        />
      );

    case 'soft_clay':
    default:
      return (
        <SoftClayMaterial
          isSelected={isSelected}
          isHovered={isHovered}
          hoverTintColor={hoverTintColor}
          selectedTintColor={selectedTintColor}
          hoverTintStrength={hoverTintStrength}
          selectedTintStrength={selectedTintStrength}
          useVertexColors={useVertexColors}
          meshColor={meshColor}
          materialRoughness={materialRoughness}
          clippingPlanes={clippingPlanes}
          supportCoverageTips={supportCoverageTips}
          supportCoverageColor={supportCoverageColor}
          supportCoverageIntensity={supportCoverageIntensity}
          islandMarkers={islandMarkers}
          showIslands={showIslands}
          islandColor={islandColor}
          islandIntensity={islandIntensity}
          islandRadiusFactor={islandRadiusFactor}
          islandColumnHeight={islandColumnHeight}
          showOverhang={showOverhang}
          overhangColor={overhangColor}
          overhangAngleDeg={overhangAngleDeg}
          overhangIntensity={overhangIntensity}
          overhangProximityMm={overhangProximityMm}
        />
      );
  }
}
