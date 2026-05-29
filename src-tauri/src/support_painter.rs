use std::sync::{Arc, Mutex, OnceLock};
use std::collections::{HashMap, VecDeque, HashSet, BinaryHeap};
use serde::{Serialize, Deserialize};
use dragonfruit_mesh_repair::{IndexedMesh, core::halfedge::Topology, core::mesh::Vec3};

/// Estimated curvature attributes per triangle for smart brush evaluations.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TriangleCurvature {
    /// Maximum principal curvature estimate (based on the sharpest neighboring dihedral angle)
    pub k1: f32,
    /// Minimum principal curvature estimate (based on the flattest neighboring dihedral angle)
    pub k2: f32,
    /// Gaussian curvature estimate
    pub gaussian: f32,
    /// Mean curvature estimate
    pub mean: f32,
}

/// Cached topological and geometric analysis for a model.
#[allow(dead_code)]
pub struct CachedModelData {
    pub mesh: IndexedMesh,
    pub topology: Topology,
    pub normals: Vec<Vec3>,
    pub curvatures: Vec<TriangleCurvature>,
}

static MODEL_CACHE: OnceLock<Mutex<HashMap<String, Arc<CachedModelData>>>> = OnceLock::new();

pub fn get_model_cache() -> &'static Mutex<HashMap<String, Arc<CachedModelData>>> {
    MODEL_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Estimates discrete surface curvatures (k1, k2, gaussian, mean) for all triangles in the mesh.
pub fn estimate_curvatures(mesh: &IndexedMesh, topology: &Topology, normals: &[Vec3]) -> Vec<TriangleCurvature> {
    let tri_count = mesh.triangle_count();
    let mut curvatures = vec![
        TriangleCurvature { k1: 0.0, k2: 0.0, gaussian: 0.0, mean: 0.0 };
        tri_count
    ];

    for fi in 0..tri_count {
        let tri = mesh.triangles[fi];
        let n_fi = normals[fi];

        // Traverse the three edges of the triangle to evaluate adjacent face normal variations
        let mut dihedral_angles = Vec::with_capacity(3);

        for &(u, v) in &[(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
            let edge_key = dragonfruit_mesh_repair::core::halfedge::edge_key(u, v);
            if let Some(edge_info) = topology.edges.get(&edge_key) {
                let mut max_angle: f32 = 0.0;
                for &adj_fi in &edge_info.faces {
                    if adj_fi != fi as u32 {
                        let n_adj = normals[adj_fi as usize];
                        let dot = n_fi.dot(n_adj).clamp(-1.0, 1.0);
                        let angle = dot.acos(); // Dihedral angle in radians
                        if angle > max_angle {
                            max_angle = angle;
                        }
                    }
                }
                dihedral_angles.push(max_angle);
            } else {
                dihedral_angles.push(0.0); // Boundary edge
            }
        }

        // Sort angles to extract principal curvatures
        dihedral_angles.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let k1 = dihedral_angles[2]; // Maximum dihedral angle deviation (ridge indicator)
        let k2 = dihedral_angles[0]; // Minimum dihedral angle deviation (plane indicator)

        curvatures[fi] = TriangleCurvature {
            k1,
            k2,
            gaussian: k1 * k2,
            mean: (k1 + k2) * 0.5,
        };
    }

    curvatures
}

/// Tauri IPC Command: Welds flat triangle soup, builds topological half-edges,
/// computes normals and curvatures, and caches them in memory.
#[tauri::command]
pub async fn initialize_support_painter_model(
    model_id: String,
    positions: Vec<f32>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        log::info!("[support-painter] Initializing topology for model {} ({} floats)", model_id, positions.len());

        let start_time = std::time::Instant::now();
        
        // 1. Reconstruct indexed watertight mesh by welding coincident vertices
        let mesh = IndexedMesh::from_triangle_soup(&positions, 1e-5);
        let weld_elapsed = start_time.elapsed();

        // 2. Build half-edge topological adjacencies
        let topology = Topology::build(&mesh);
        let topo_elapsed = start_time.elapsed() - weld_elapsed;

        // 3. Compute per-triangle face normals
        let tri_count = mesh.triangle_count();
        let mut normals = Vec::with_capacity(tri_count);
        for fi in 0..tri_count {
            normals.push(mesh.tri_normal(fi as u32));
        }

        // 4. Estimate surface curvatures
        let curvatures = estimate_curvatures(&mesh, &topology, &normals);
        let curv_elapsed = start_time.elapsed() - weld_elapsed - topo_elapsed;

        log::info!(
            "[support-painter] Topology cache built in {:?}. weld={:?} topo={:?} curv={:?} triangles={} vertices={}",
            start_time.elapsed(),
            weld_elapsed,
            topo_elapsed,
            curv_elapsed,
            mesh.triangle_count(),
            mesh.vertex_count()
        );

        let cached = Arc::new(CachedModelData {
            mesh,
            topology,
            normals,
            curvatures,
        });

        let mut cache = get_model_cache().lock().map_err(|e| e.to_string())?;
        cache.insert(model_id.clone(), cached);

        Ok(format!("Topology cached. triangles={}", tri_count))
    })
    .await
    .map_err(|e| format!("Initialization task panicked: {e}"))?
}

/// Tauri IPC Command: Evicts the cached model topology from memory.
#[tauri::command]
pub async fn clear_support_painter_model(model_id: String) -> Result<bool, String> {
    let mut cache = get_model_cache().lock().map_err(|e| e.to_string())?;
    let removed = cache.remove(&model_id).is_some();
    if removed {
        log::info!("[support-painter] Evicted cached model {}", model_id);
    }
    Ok(removed)
}

/// Tauri IPC Command: Real-time region proposals debounced on mouse pointer move.
/// Compute the centroid coordinates of a triangle.
fn tri_centroid(mesh: &IndexedMesh, face: u32) -> Vec3 {
    let [a, b, c] = mesh.tri_positions(face);
    Vec3::new(
        (a.x + b.x + c.x) / 3.0,
        (a.y + b.y + c.y) / 3.0,
        (a.z + b.z + c.z) / 3.0,
    )
}

/// Retrieve unique adjacent faces for a given face by traversing its edges.
fn adj_faces(mesh: &IndexedMesh, topology: &Topology, face: u32) -> Vec<u32> {
    let tri = mesh.triangles[face as usize];
    let mut adjs = Vec::with_capacity(3);
    for &(u, v) in &[(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
        let edge_key = dragonfruit_mesh_repair::core::halfedge::edge_key(u, v);
        if let Some(edge_info) = topology.edges.get(&edge_key) {
            for &adj_fi in &edge_info.faces {
                if adj_fi != face && !adjs.contains(&adj_fi) {
                    adjs.push(adj_fi);
                }
            }
        }
    }
    adjs
}

#[derive(Copy, Clone, PartialEq)]
struct DijkstraState {
    cost: f32,
    face: u32,
}

impl Eq for DijkstraState {}

impl Ord for DijkstraState {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other.cost.partial_cmp(&self.cost).unwrap_or(std::cmp::Ordering::Equal)
    }
}

impl PartialOrd for DijkstraState {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Tauri IPC Command: Real-time region proposals debounced on mouse pointer move.
/// Returns a Vec<u32> containing matching triangle IDs.
/// Phase 3: Implements smart-brush mathematical suites: MacroFace, Ridge, Cylinder, and Point.
#[tauri::command]
pub async fn propose_brush_region(
    model_id: String,
    seed_triangle_id: u32,
    brush_type: String,
) -> Result<Vec<u32>, String> {
    let cache_lock = get_model_cache().lock().map_err(|e| e.to_string())?;
    let cached = cache_lock.get(&model_id).ok_or_else(|| {
        format!("Model {} is not initialized in the support painter cache.", model_id)
    })?;

    let seed = seed_triangle_id as usize;
    if seed >= cached.mesh.triangle_count() {
        return Err(format!("Seed triangle ID {} is out of mesh bounds.", seed_triangle_id));
    }

    match brush_type.as_str() {
        "MacroFace" => {
            let mut queue = VecDeque::new();
            let mut visited = HashSet::new();
            
            if cached.normals[seed].z <= 0.2 {
                let seed_normal = cached.normals[seed];
                queue.push_back(seed_triangle_id);
                visited.insert(seed_triangle_id);

                while let Some(curr) = queue.pop_front() {
                    let adjs = adj_faces(&cached.mesh, &cached.topology, curr);
                    for adj in adjs {
                        if !visited.contains(&adj) {
                            let n_adj = cached.normals[adj as usize];
                            if n_adj.z <= 0.2 {
                                // 35 degrees = 0.61 radians normal deviation tolerance
                                let normal_deviation = seed_normal.dot(n_adj).clamp(-1.0, 1.0).acos();

                                let n_curr = cached.normals[curr as usize];
                                // 25 degrees = 0.43 radians edge-guard dihedral tolerance
                                let edge_dihedral = n_curr.dot(n_adj).clamp(-1.0, 1.0).acos();

                                if normal_deviation < 0.61 && edge_dihedral < 0.43 {
                                    visited.insert(adj);
                                    queue.push_back(adj);
                                }
                            }
                        }
                    }
                }
            }
            let filtered: Vec<u32> = visited.into_iter()
                .filter(|&adj| cached.normals[adj as usize].z <= 0.0)
                .collect();
            Ok(filtered)
        }
        "Ridge" => {
            let mut visited = HashSet::new();

            if cached.normals[seed].z <= 0.2 && cached.curvatures[seed].k1 > 0.10 {
                visited.insert(seed_triangle_id);

                // Get adjacent faces of the seed
                let adjs = adj_faces(&cached.mesh, &cached.topology, seed_triangle_id);
                let mut candidates: Vec<u32> = adjs.into_iter()
                    .filter(|&adj| {
                        let idx = adj as usize;
                        cached.normals[idx].z <= 0.2 && cached.curvatures[idx].k1 > 0.10
                    })
                    .collect();

                // Sort candidates by curvature k1 descending (sharpest crease first)
                candidates.sort_by(|&a, &b| {
                    cached.curvatures[b as usize].k1.partial_cmp(&cached.curvatures[a as usize].k1).unwrap_or(std::cmp::Ordering::Equal)
                });

                // Follow branch A (the sharpest neighboring crease)
                if candidates.len() > 0 {
                    let mut curr_a = candidates[0];
                    visited.insert(curr_a);

                    loop {
                        let adjs_a = adj_faces(&cached.mesh, &cached.topology, curr_a);
                        let mut next_candidates: Vec<u32> = adjs_a.into_iter()
                            .filter(|&adj| {
                                let idx = adj as usize;
                                !visited.contains(&adj) && cached.normals[idx].z <= 0.2 && cached.curvatures[idx].k1 > 0.10
                            })
                            .collect();
                        if next_candidates.is_empty() {
                            break;
                        }
                        // Greedily pick the neighbor with the maximum curvature
                        next_candidates.sort_by(|&a, &b| {
                            cached.curvatures[b as usize].k1.partial_cmp(&cached.curvatures[a as usize].k1).unwrap_or(std::cmp::Ordering::Equal)
                        });
                        curr_a = next_candidates[0];
                        visited.insert(curr_a);
                    }
                }

                // Follow branch B (the second sharpest neighboring crease, extending in the opposite direction)
                if candidates.len() > 1 {
                    let mut curr_b = candidates[1];
                    visited.insert(curr_b);

                    loop {
                        let adjs_b = adj_faces(&cached.mesh, &cached.topology, curr_b);
                        let mut next_candidates: Vec<u32> = adjs_b.into_iter()
                            .filter(|&adj| {
                                let idx = adj as usize;
                                !visited.contains(&adj) && cached.normals[idx].z <= 0.2 && cached.curvatures[idx].k1 > 0.10
                            })
                            .collect();
                        if next_candidates.is_empty() {
                            break;
                        }
                        // Greedily pick the neighbor with the maximum curvature
                        next_candidates.sort_by(|&a, &b| {
                            cached.curvatures[b as usize].k1.partial_cmp(&cached.curvatures[a as usize].k1).unwrap_or(std::cmp::Ordering::Equal)
                        });
                        curr_b = next_candidates[0];
                        visited.insert(curr_b);
                    }
                }
            }
            let filtered: Vec<u32> = visited.into_iter()
                .filter(|&adj| cached.normals[adj as usize].z <= 0.0)
                .collect();
            Ok(filtered)
        }
        "CylinderSides" => {
            let mut queue = VecDeque::new();
            let mut visited = HashSet::new();

            let seed_curv = &cached.curvatures[seed];
            if cached.normals[seed].z <= 0.2 && seed_curv.k1 > 0.02 && seed_curv.k2 < 0.05 {
                queue.push_back(seed_triangle_id);
                visited.insert(seed_triangle_id);

                while let Some(curr) = queue.pop_front() {
                    let adjs = adj_faces(&cached.mesh, &cached.topology, curr);
                    for adj in adjs {
                        if !visited.contains(&adj) {
                            let idx = adj as usize;
                            if cached.normals[idx].z <= 0.2 {
                                let curv = &cached.curvatures[idx];
                                if curv.k1 > 0.02 && curv.k2 < 0.05 {
                                    visited.insert(adj);
                                    queue.push_back(adj);
                                }
                            }
                        }
                    }
                }
            }
            let filtered: Vec<u32> = visited.into_iter()
                .filter(|&adj| cached.normals[adj as usize].z <= 0.0)
                .collect();
            Ok(filtered)
        }
        "CylinderMinima" => {
            let mut visited = HashSet::new();

            let seed_curv = &cached.curvatures[seed];
            if cached.normals[seed].z <= 0.2 && seed_curv.k1 > 0.02 && seed_curv.k2 < 0.05 {
                visited.insert(seed_triangle_id);

                // Get adjacent faces of the seed
                let adjs = adj_faces(&cached.mesh, &cached.topology, seed_triangle_id);
                let mut candidates: Vec<u32> = adjs.into_iter()
                    .filter(|&adj| {
                        let idx = adj as usize;
                        let curv = &cached.curvatures[idx];
                        cached.normals[idx].z <= 0.2 && curv.k1 > 0.02 && curv.k2 < 0.05
                    })
                    .collect();

                // Sort candidates by normal.z ascending (most straight down first, closest to -1.0)
                candidates.sort_by(|&a, &b| {
                    cached.normals[a as usize].z.partial_cmp(&cached.normals[b as usize].z).unwrap_or(std::cmp::Ordering::Equal)
                });

                // Follow branch A (the most downward-facing cylinder segment)
                if candidates.len() > 0 {
                    let mut curr_a = candidates[0];
                    visited.insert(curr_a);

                    loop {
                        let adjs_a = adj_faces(&cached.mesh, &cached.topology, curr_a);
                        let mut next_candidates: Vec<u32> = adjs_a.into_iter()
                            .filter(|&adj| {
                                let idx = adj as usize;
                                let curv = &cached.curvatures[idx];
                                !visited.contains(&adj) && cached.normals[idx].z <= 0.2 && curv.k1 > 0.02 && curv.k2 < 0.05
                            })
                            .collect();
                        if next_candidates.is_empty() {
                            break;
                        }
                        // Greedily pick the neighbor that points most centrally down (min normal.z)
                        next_candidates.sort_by(|&a, &b| {
                            cached.normals[a as usize].z.partial_cmp(&cached.normals[b as usize].z).unwrap_or(std::cmp::Ordering::Equal)
                        });
                        curr_a = next_candidates[0];
                        visited.insert(curr_a);
                    }
                }

                // Follow branch B (the second most downward-facing segment, extending opposite)
                if candidates.len() > 1 {
                    let mut curr_b = candidates[1];
                    visited.insert(curr_b);

                    loop {
                        let adjs_b = adj_faces(&cached.mesh, &cached.topology, curr_b);
                        let mut next_candidates: Vec<u32> = adjs_b.into_iter()
                            .filter(|&adj| {
                                let idx = adj as usize;
                                let curv = &cached.curvatures[idx];
                                !visited.contains(&adj) && cached.normals[idx].z <= 0.2 && curv.k1 > 0.02 && curv.k2 < 0.05
                            })
                            .collect();
                        if next_candidates.is_empty() {
                            break;
                        }
                        // Greedily pick the neighbor that points most centrally down (min normal.z)
                        next_candidates.sort_by(|&a, &b| {
                            cached.normals[a as usize].z.partial_cmp(&cached.normals[b as usize].z).unwrap_or(std::cmp::Ordering::Equal)
                        });
                        curr_b = next_candidates[0];
                        visited.insert(curr_b);
                    }
                }
            }
            let filtered: Vec<u32> = visited.into_iter()
                .filter(|&adj| cached.normals[adj as usize].z <= 0.0)
                .collect();
            Ok(filtered)
        }
        "Point" => {
            let mut proposed = Vec::new();
            let mut dists = HashMap::new();
            let mut heap = BinaryHeap::new();

            if cached.normals[seed].z <= 0.2 {
                let r_limit = 8.0f32; // Geodesic radius limit in mm
                dists.insert(seed_triangle_id, 0.0f32);
                heap.push(DijkstraState { cost: 0.0, face: seed_triangle_id });

                while let Some(DijkstraState { cost, face }) = heap.pop() {
                    if cost > r_limit {
                        continue;
                    }
                    if !proposed.contains(&face) {
                        proposed.push(face);
                    }

                    let centroid_curr = tri_centroid(&cached.mesh, face);
                    let adjs = adj_faces(&cached.mesh, &cached.topology, face);
                    for adj in adjs {
                        let idx = adj as usize;
                        if cached.normals[idx].z <= 0.2 {
                            let centroid_adj = tri_centroid(&cached.mesh, adj);
                            let step_cost = centroid_curr.sub(centroid_adj).length();
                            let next_cost = cost + step_cost;

                            let current_best = *dists.get(&adj).unwrap_or(&f32::INFINITY);
                            if next_cost < current_best && next_cost <= r_limit {
                                dists.insert(adj, next_cost);
                                heap.push(DijkstraState { cost: next_cost, face: adj });
                            }
                        }
                    }
                }
            }
            let filtered: Vec<u32> = proposed.into_iter()
                .filter(|&adj| cached.normals[adj as usize].z <= 0.0)
                .collect();
            Ok(filtered)
        }
        "Ring" => {
            let mut queue = VecDeque::new();
            let mut visited = HashSet::new();

            if cached.normals[seed].z <= 0.2 {
                let seed_centroid = tri_centroid(&cached.mesh, seed_triangle_id);
                let seed_z = seed_centroid.z;

                queue.push_back(seed_triangle_id);
                visited.insert(seed_triangle_id);

                while let Some(curr) = queue.pop_front() {
                    let adjs = adj_faces(&cached.mesh, &cached.topology, curr);
                    for adj in adjs {
                        if !visited.contains(&adj) {
                            if cached.normals[adj as usize].z <= 0.2 {
                                let [a, b, c] = cached.mesh.tri_positions(adj);
                                let min_z = a.z.min(b.z).min(c.z);
                                let max_z = a.z.max(b.z).max(c.z);

                                // Contiguous check within Z +- 1.0mm thickness
                                if min_z <= seed_z + 1.0 && max_z >= seed_z - 1.0 {
                                    visited.insert(adj);
                                    queue.push_back(adj);
                                }
                            }
                        }
                    }
                }
            }

            // Bound final proposal strictly to downward-facing and horizontal normals,
            // excluding strictly upward-pointing ones (nz <= 0.0)
            let filtered: Vec<u32> = visited.into_iter()
                .filter(|&adj| cached.normals[adj as usize].z <= 0.0)
                .collect();
            Ok(filtered)
        }
        _ => {
            // Fallback: return seed face + 1-ring neighbors (Phase 2 legacy) if normal points below horizontal
            let mut proposed = Vec::new();
            if cached.normals[seed].z <= 0.2 {
                proposed.push(seed_triangle_id);
                let tri = cached.mesh.triangles[seed];
                for &(u, v) in &[(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
                    let edge_key = dragonfruit_mesh_repair::core::halfedge::edge_key(u, v);
                    if let Some(edge_info) = cached.topology.edges.get(&edge_key) {
                        for &adj_fi in &edge_info.faces {
                            if adj_fi != seed_triangle_id && !proposed.contains(&adj_fi) {
                                if cached.normals[adj_fi as usize].z <= 0.2 {
                                    proposed.push(adj_fi);
                                }
                            }
                        }
                    }
                }
            }
            let filtered: Vec<u32> = proposed.into_iter()
                .filter(|&adj| cached.normals[adj as usize].z <= 0.0)
                .collect();
            Ok(filtered)
        }
    }
}

/// Möller–Trumbore ray-triangle intersection algorithm.
/// Returns Some(t) where t is the distance from orig along dir to the intersection point.
fn ray_triangle_intersect(
    orig: &Vec3,
    dir: &Vec3,
    v0: &Vec3,
    v1: &Vec3,
    v2: &Vec3,
) -> Option<f32> {
    let edge1 = Vec3::new(v1.x - v0.x, v1.y - v0.y, v1.z - v0.z);
    let edge2 = Vec3::new(v2.x - v0.x, v2.y - v0.y, v2.z - v0.z);

    // Compute determinant vector pvec
    let pvec = Vec3::new(
        dir.y * edge2.z - dir.z * edge2.y,
        dir.z * edge2.x - dir.x * edge2.z,
        dir.x * edge2.y - dir.y * edge2.x,
    );
    let det = edge1.dot(pvec);

    // If determinant is near zero, ray lies in plane of triangle or is parallel
    if det.abs() < 1e-8 {
        return None;
    }

    let inv_det = 1.0 / det;

    // Calculate distance from v0 to ray origin
    let tvec = Vec3::new(orig.x - v0.x, orig.y - v0.y, orig.z - v0.z);

    // Calculate u parameter and test bounds
    let u = tvec.dot(pvec) * inv_det;
    if u < 0.0 || u > 1.0 {
        return None;
    }

    // Calculate qvec
    let qvec = Vec3::new(
        tvec.y * edge1.z - tvec.z * edge1.y,
        tvec.z * edge1.x - tvec.x * edge1.z,
        tvec.x * edge1.y - tvec.y * edge1.x,
    );

    // Calculate v parameter and test bounds
    let v = dir.dot(qvec) * inv_det;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }

    // Calculate t parameter
    let t = edge2.dot(qvec) * inv_det;
    if t > 1e-5 {
        Some(t)
    } else {
        None
    }
}

/// Robust Even-Odd raycasting solidness checker.
/// Casts a ray in the -Z direction from a slightly perturbed origin to avoid edge/vertex alignment issues.
/// Returns true if the point lies inside the solid volume of the watertight mesh.
fn is_point_inside_mesh(orig: &Vec3, mesh: &IndexedMesh) -> bool {
    let mut hits = 0;
    let dir = Vec3::new(0.0, 0.0, -1.0);

    // Perturb the origin slightly in X/Y plane to avoid exact vertex/edge alignment
    let perturbed_orig = Vec3::new(
        orig.x + 1.123e-5,
        orig.y + 2.456e-5,
        orig.z
    );

    let tri_count = mesh.triangle_count();
    for fi in 0..tri_count {
        let [v0, v1, v2] = mesh.tri_positions(fi as u32);
        if ray_triangle_intersect(&perturbed_orig, &dir, &v0, &v1, &v2).is_some() {
            hits += 1;
        }
    }

    hits % 2 == 1
}

/// A detected local vertical minimum.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalMinimum {
    pub vertex_index: u32,
    pub position: Vec3,
    pub seed_triangle_id: u32,
}

/// Tauri IPC Command: Walks the model adjacency graph to locate all local vertical minima.
/// A vertex is classified as a local vertical minimum if its Z height is strictly
/// less than all its immediate graph neighbor vertices.
#[tauri::command]
pub async fn find_all_local_minima(model_id: String) -> Result<Vec<LocalMinimum>, String> {
    let cached = {
        let cache_lock = get_model_cache().lock().map_err(|e| e.to_string())?;
        cache_lock.get(&model_id).ok_or_else(|| {
            format!("Model {} is not initialized in the support painter cache.", model_id)
        })?.clone()
    };

    tauri::async_runtime::spawn_blocking(move || {
        let mesh = &cached.mesh;
        let tri_count = mesh.triangle_count();
        let vert_count = mesh.vertex_count();

        // 1. Build vertex-to-vertex adjacency map, vertex-to-face seed map, and adjacent faces list
        let mut adj_vertices = vec![HashSet::new(); vert_count];
        let mut vert_to_face = vec![u32::MAX; vert_count];
        let mut vert_to_faces = vec![Vec::new(); vert_count];

        for fi in 0..tri_count {
            let tri = mesh.triangles[fi];
            let face_id = fi as u32;

            for &(u, v, w) in &[(tri[0], tri[1], tri[2]), (tri[1], tri[2], tri[0]), (tri[2], tri[0], tri[1])] {
                adj_vertices[u as usize].insert(v);
                adj_vertices[u as usize].insert(w);
                vert_to_face[u as usize] = face_id;
                vert_to_faces[u as usize].push(face_id);
            }
        }

        // 2. Scan vertices to isolate local minima
        let mut local_minima = Vec::new();
        for vi in 0..vert_count {
            let z_i = mesh.positions[vi].z;
            let mut is_minimum = true;

            let neighbors = &adj_vertices[vi];
            if neighbors.is_empty() {
                continue;
            }

            for &neighbor in neighbors {
                if mesh.positions[neighbor as usize].z <= z_i {
                    is_minimum = false;
                    break;
                }
            }

            if is_minimum {
                // Compute the vertex normal Z-component as a fast heuristic
                let mut v_normal = Vec3::new(0.0, 0.0, 0.0);
                for &fi in &vert_to_faces[vi] {
                    let fnorm = cached.normals[fi as usize];
                    v_normal.x += fnorm.x;
                    v_normal.y += fnorm.y;
                    v_normal.z += fnorm.z;
                }
                let len = (v_normal.x * v_normal.x + v_normal.y * v_normal.y + v_normal.z * v_normal.z).sqrt();
                let nz = if len > 0.0 { v_normal.z / len } else { 0.0 };

                // Hybrid Filtration:
                // - If the normal is clearly pointing downwards (nz < -0.05), it is a valid bottom overhang.
                // - If the normal is flat or pointing upwards (nz >= -0.05), it could be a top-surface concavity.
                //   We run the robust global Even-Odd raycast filter on these potential top-surface candidates.
                let mut keep = true;
                if nz >= -0.05 {
                    let test_pt = Vec3::new(
                        mesh.positions[vi].x,
                        mesh.positions[vi].y,
                        mesh.positions[vi].z - 1e-4
                    );
                    if is_point_inside_mesh(&test_pt, mesh) {
                        keep = false;
                    }
                }

                if keep {
                    local_minima.push(LocalMinimum {
                        vertex_index: vi as u32,
                        position: mesh.positions[vi],
                        seed_triangle_id: vert_to_face[vi],
                    });
                }
            }
        }

        log::info!(
            "[support-painter] Minima scanner complete for model {}. Identified {} local minima.",
            model_id,
            local_minima.len()
        );

        Ok(local_minima)
    })
    .await
    .map_err(|e| format!("Minima scanner task panicked: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_local_minima_scanner() {
        // Flat triangle soup for a downward-pointing pyramid:
        // v0: (0, 0, -1) (Valley minima)
        // v1: (-1, -1, 0)
        // v2: (1, -1, 0)
        // v3: (1, 1, 0)
        // v4: (-1, 1, 0)
        let soup = vec![
            // T0: [v0, v2, v1]
            0.0, 0.0, -1.0,   1.0, -1.0, 0.0,  -1.0, -1.0, 0.0,
            // T1: [v0, v3, v2]
            0.0, 0.0, -1.0,   1.0, 1.0, 0.0,   1.0, -1.0, 0.0,
            // T2: [v0, v4, v3]
            0.0, 0.0, -1.0,  -1.0, 1.0, 0.0,   1.0, 1.0, 0.0,
            // T3: [v0, v1, v4]
            0.0, 0.0, -1.0,  -1.0, -1.0, 0.0,  -1.0, 1.0, 0.0,
        ];

        let mesh = IndexedMesh::from_triangle_soup(&soup, 1e-5);
        assert_eq!(mesh.vertex_count(), 5);

        // Build adjacency map
        let mut adj_vertices = vec![HashSet::new(); mesh.vertex_count()];
        for tri in &mesh.triangles {
            for &(u, v, w) in &[(tri[0], tri[1], tri[2]), (tri[1], tri[2], tri[0]), (tri[2], tri[0], tri[1])] {
                adj_vertices[u as usize].insert(v);
                adj_vertices[u as usize].insert(w);
            }
        }

        // v0 has index 0, check if it is vertical minima
        let z_0 = mesh.positions[0].z;
        assert_eq!(z_0, -1.0);

        let mut is_minimum = true;
        for &neighbor in &adj_vertices[0] {
            if mesh.positions[neighbor as usize].z <= z_0 {
                is_minimum = false;
            }
        }
        assert!(is_minimum);
    }

    #[test]
    fn test_local_minima_top_surface_filtration() {
        // Construct an upright watertight cup mesh.
        // v0-v3: Outer bottom Z=0.0
        // v4: Bottom outer tip at Z=-0.5 (True downward overhang minimum)
        // v5-v8: Outer top rim Z=2.0
        // v9-v12: Inner top rim Z=2.0
        // v13-v16: Inner bottom floor Z=1.0
        // v17: Inner bottom tip at Z=0.5 (Top-surface concavity, local minimum but not overhang)
        let v0 = [-2.0, -2.0, 0.0];
        let v1 = [2.0, -2.0, 0.0];
        let v2 = [2.0, 2.0, 0.0];
        let v3 = [-2.0, 2.0, 0.0];
        let v4 = [0.0, 0.0, -0.5];

        let v5 = [-2.0, -2.0, 2.0];
        let v6 = [2.0, -2.0, 2.0];
        let v7 = [2.0, 2.0, 2.0];
        let v8 = [-2.0, 2.0, 2.0];

        let v9 = [-1.5, -1.5, 2.0];
        let v10 = [1.5, -1.5, 2.0];
        let v11 = [1.5, 1.5, 2.0];
        let v12 = [-1.5, 1.5, 2.0];

        let v13 = [-1.5, -1.5, 1.0];
        let v14 = [1.5, -1.5, 1.0];
        let v15 = [1.5, 1.5, 1.0];
        let v16 = [-1.5, 1.5, 1.0];
        let v17 = [0.0, 0.0, 0.5];

        let vertices = vec![
            v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15, v16, v17
        ];

        let mut soup = Vec::new();
        let mut push_tri = |a: usize, b: usize, c: usize| {
            soup.extend_from_slice(&[
                vertices[a][0], vertices[a][1], vertices[a][2],
                vertices[b][0], vertices[b][1], vertices[b][2],
                vertices[c][0], vertices[c][1], vertices[c][2],
            ]);
        };

        // Outer bottom CCW from bottom
        push_tri(4, 1, 0);
        push_tri(4, 2, 1);
        push_tri(4, 3, 2);
        push_tri(4, 0, 3);

        // Outer walls CCW from outside
        push_tri(0, 1, 6); push_tri(0, 6, 5);
        push_tri(1, 2, 7); push_tri(1, 7, 6);
        push_tri(2, 3, 8); push_tri(2, 8, 7);
        push_tri(3, 0, 5); push_tri(3, 5, 8);

        // Top rim CCW from top
        push_tri(5, 6, 10); push_tri(5, 10, 9);
        push_tri(6, 7, 11); push_tri(6, 11, 10);
        push_tri(7, 8, 12); push_tri(7, 12, 11);
        push_tri(8, 5, 9); push_tri(8, 9, 12);

        // Inner walls CCW from inside void
        push_tri(9, 13, 14); push_tri(9, 14, 10);
        push_tri(10, 14, 15); push_tri(10, 15, 11);
        push_tri(11, 15, 16); push_tri(11, 16, 12);
        push_tri(12, 16, 13); push_tri(12, 13, 9);

        // Inner bottom CCW from inside void
        push_tri(17, 13, 14);
        push_tri(17, 14, 15);
        push_tri(17, 15, 16);
        push_tri(17, 16, 13);

        let mesh = IndexedMesh::from_triangle_soup(&soup, 1e-5);

        // Calculate face normals
        let mut normals = Vec::new();
        for fi in 0..mesh.triangle_count() {
            normals.push(mesh.tri_normal(fi as u32));
        }

        // Build adjacency and vert_to_faces
        let mut adj_vertices = vec![HashSet::new(); mesh.vertex_count()];
        let mut vert_to_face = vec![u32::MAX; mesh.vertex_count()];
        let mut vert_to_faces = vec![Vec::new(); mesh.vertex_count()];

        for fi in 0..mesh.triangle_count() {
            let tri = mesh.triangles[fi];
            let face_id = fi as u32;
            for &(u, v, w) in &[(tri[0], tri[1], tri[2]), (tri[1], tri[2], tri[0]), (tri[2], tri[0], tri[1])] {
                adj_vertices[u as usize].insert(v);
                adj_vertices[u as usize].insert(w);
                vert_to_face[u as usize] = face_id;
                vert_to_faces[u as usize].push(face_id);
            }
        }

        let mut kept_minima = Vec::new();
        for vi in 0..mesh.vertex_count() {
            let z_i = mesh.positions[vi].z;
            let mut is_minimum = true;
            let neighbors = &adj_vertices[vi];
            if neighbors.is_empty() {
                continue;
            }
            for &neighbor in neighbors {
                if mesh.positions[neighbor as usize].z <= z_i {
                    is_minimum = false;
                    break;
                }
            }

            if is_minimum {
                let mut v_normal = Vec3::new(0.0, 0.0, 0.0);
                for &fi in &vert_to_faces[vi] {
                    let fnorm = normals[fi as usize];
                    v_normal.x += fnorm.x;
                    v_normal.y += fnorm.y;
                    v_normal.z += fnorm.z;
                }
                let len = (v_normal.x * v_normal.x + v_normal.y * v_normal.y + v_normal.z * v_normal.z).sqrt();
                let nz = if len > 0.0 { v_normal.z / len } else { 0.0 };

                let mut keep = true;
                if nz >= -0.05 {
                    let test_pt = Vec3::new(
                        mesh.positions[vi].x,
                        mesh.positions[vi].y,
                        mesh.positions[vi].z - 1e-4
                    );
                    if is_point_inside_mesh(&test_pt, &mesh) {
                        keep = false;
                    }
                }
                if keep {
                    kept_minima.push(vi);
                }
            }
        }

        // Locate welded indices of v4 and v17 dynamically by their unique coordinates
        let mut index_v4 = None;
        let mut index_v17 = None;
        for i in 0..mesh.vertex_count() {
            let pos = mesh.positions[i];
            if (pos.x - 0.0).abs() < 1e-4 && (pos.y - 0.0).abs() < 1e-4 && (pos.z - (-0.5)).abs() < 1e-4 {
                index_v4 = Some(i);
            }
            if (pos.x - 0.0).abs() < 1e-4 && (pos.y - 0.0).abs() < 1e-4 && (pos.z - 0.5).abs() < 1e-4 {
                index_v17 = Some(i);
            }
        }
        let index_v4 = index_v4.expect("Failed to locate welded v4 vertex");
        let index_v17 = index_v17.expect("Failed to locate welded v17 vertex");

        // Verify that only the bottom outer tip is kept,
        // and the inner bottom tip is successfully filtered out!
        assert!(kept_minima.contains(&index_v4));
        assert!(!kept_minima.contains(&index_v17));
    }
}
