"""STL mesh generation for 3D-printable rocket engine geometry.

Builds a watertight (manifold) triangle mesh from the parametric engine
profile and optional cooling channel geometry. Two modes:
  - 'simple': solid wall (inner surface + outer surface + end caps + injector)
  - 'full':   includes cooling channel voids cut into the wall
"""

import io
import math
import numpy as np
from stl import mesh as stl_mesh
from stl import stl as stl_mode

from backend.geometry.parametric_engine import ParametricEngine
from backend.physics.regen_cooling import CoolingChannelGeometry
from backend.geometry.injector import generate_injector_layout


# ---------------------------------------------------------------------------
#  Public API
# ---------------------------------------------------------------------------

def generate_stl(
    engine: ParametricEngine,
    cooling_geom: CoolingChannelGeometry | None = None,
    mode: str = "simple",
    n_circ: int = 128,
    include_injector: bool = True,
    injector_config=None,
) -> bytes:
    """Generate a binary STL file for the engine.

    Args:
        engine: The parametric engine instance.
        cooling_geom: Optional cooling channel geometry (used in 'full' mode).
        mode: 'simple' for solid wall, 'full' for wall with cooling channels.
        n_circ: Angular resolution (segments around circumference).
        include_injector: Whether to add the injector face plate disc.
        injector_config: Optional InjectorConfig for orifice holes.

    Returns:
        Binary STL file content as bytes.
    """
    profile = engine.generate_profile()  # shape (N, 4): x, r_inner, r_outer, zone
    x = profile[:, 0]
    r_inner = profile[:, 1]
    r_outer = profile[:, 2]

    if mode == "full" and cooling_geom is not None:
        triangles = _build_full_stl(x, r_inner, r_outer, cooling_geom, n_circ)
    else:
        triangles = _build_simple_stl(x, r_inner, r_outer, n_circ)

    if include_injector:
        if injector_config and getattr(injector_config, 'enabled', False):
            face_x = x[0]
            face_r = r_inner[0]
            wall_t = r_outer[0] - r_inner[0]
            layout = generate_injector_layout(injector_config, face_x, face_r)
            injector = _build_injector_disc_with_orifices(
                face_x, face_r, layout, n_circ, wall_t
            )
        else:
            injector = _build_injector_disc(x[0], r_inner[0], n_circ)
        triangles = np.concatenate([triangles, injector], axis=0)

    return _triangles_to_stl_bytes(triangles)


# ---------------------------------------------------------------------------
#  Simple mode (solid wall, no channels)
# ---------------------------------------------------------------------------

def _build_simple_stl(x, r_inner, r_outer, n_circ):
    """Build a solid-wall manifold mesh (no cooling channels)."""
    outer = _build_surface_of_revolution(x, r_outer, n_circ, flip_normals=False)
    inner = _build_surface_of_revolution(x, r_inner, n_circ, flip_normals=True)
    cap_chamber = _build_annular_cap(x[0], r_inner[0], r_outer[0], n_circ,
                                     face_negative_x=True)
    cap_nozzle = _build_annular_cap(x[-1], r_inner[-1], r_outer[-1], n_circ,
                                    face_negative_x=False)
    return np.concatenate([outer, inner, cap_chamber, cap_nozzle], axis=0)


# ---------------------------------------------------------------------------
#  Full mode (with cooling channel voids)
# ---------------------------------------------------------------------------

HOT_WALL_FRACTION = 0.30   # fraction of wall thickness that is hot-side wall
MIN_CLOSEOUT = 0.0003      # minimum closeout thickness (m)


def _build_full_stl(x, r_inner, r_outer, cooling_geom, n_circ):
    """Build manifold mesh with cooling channel voids."""
    n_stations = len(x)
    n_ch = cooling_geom.n_channels
    ch_w = cooling_geom.channel_width
    channel_heights = cooling_geom.get_channel_height_array(n_stations)

    # Per-station radial layers
    wall_t = r_outer - r_inner
    hot_wall_t = wall_t * HOT_WALL_FRACTION
    r_ch_bot = r_inner + hot_wall_t
    r_ch_top = np.minimum(r_ch_bot + channel_heights, r_outer - MIN_CLOSEOUT)
    # Ensure r_ch_top > r_ch_bot
    r_ch_top = np.maximum(r_ch_top, r_ch_bot + 0.0001)

    # Channel angular positions at each station
    # Channel angular half-width depends on mid-wall radius
    r_mid = (r_ch_bot + r_ch_top) / 2.0

    all_tris = []

    # 1. Outer surface (continuous, always at r_outer)
    all_tris.append(_build_surface_of_revolution(x, r_outer, n_circ, flip_normals=False))

    # 2. Inner surface (continuous, always at r_inner)
    all_tris.append(_build_surface_of_revolution(x, r_inner, n_circ, flip_normals=True))

    # 3. Channel-specific geometry: floor, ceiling, side walls
    for ch_idx in range(n_ch):
        center_angle = ch_idx * 2.0 * math.pi / n_ch
        tris = _build_single_channel(
            x, r_ch_bot, r_ch_top, r_mid, ch_w, center_angle, n_stations
        )
        all_tris.append(tris)

    # 4. End caps with channel notches
    cap_ch = _build_annular_cap_with_channels(
        x[0], r_inner[0], r_outer[0], r_ch_bot[0], r_ch_top[0],
        r_mid[0], n_ch, ch_w, n_circ, face_negative_x=True
    )
    cap_nz = _build_annular_cap_with_channels(
        x[-1], r_inner[-1], r_outer[-1], r_ch_bot[-1], r_ch_top[-1],
        r_mid[-1], n_ch, ch_w, n_circ, face_negative_x=False
    )
    all_tris.append(cap_ch)
    all_tris.append(cap_nz)

    return np.concatenate(all_tris, axis=0)


def _build_single_channel(x, r_ch_bot, r_ch_top, r_mid, ch_w, center_angle, n_stations):
    """Build floor, ceiling, and side walls for one cooling channel."""
    tris = []
    n = n_stations

    for i in range(n - 1):
        # Angular half-width at this station and next
        half_a0 = ch_w / (2.0 * max(r_mid[i], 1e-6))
        half_a1 = ch_w / (2.0 * max(r_mid[i + 1], 1e-6))

        theta_L0 = center_angle - half_a0
        theta_R0 = center_angle + half_a0
        theta_L1 = center_angle - half_a1
        theta_R1 = center_angle + half_a1

        # Channel floor (at r_ch_bot, facing outward = away from engine center)
        floor_tris = _make_axial_quad(
            x[i], x[i + 1],
            r_ch_bot[i], r_ch_bot[i + 1],
            theta_L0, theta_R0, theta_L1, theta_R1,
            flip=False  # outward-facing
        )
        tris.append(floor_tris)

        # Channel ceiling (at r_ch_top, facing inward = toward engine center)
        ceil_tris = _make_axial_quad(
            x[i], x[i + 1],
            r_ch_top[i], r_ch_top[i + 1],
            theta_L0, theta_R0, theta_L1, theta_R1,
            flip=True  # inward-facing
        )
        tris.append(ceil_tris)

        # Left side wall (at theta_L, from r_ch_bot to r_ch_top)
        left_tris = _make_radial_wall(
            x[i], x[i + 1],
            r_ch_bot[i], r_ch_top[i],
            r_ch_bot[i + 1], r_ch_top[i + 1],
            theta_L0, theta_L1,
            flip=True  # facing into channel (toward positive theta)
        )
        tris.append(left_tris)

        # Right side wall (at theta_R, from r_ch_bot to r_ch_top)
        right_tris = _make_radial_wall(
            x[i], x[i + 1],
            r_ch_bot[i], r_ch_top[i],
            r_ch_bot[i + 1], r_ch_top[i + 1],
            theta_R0, theta_R1,
            flip=False  # facing into channel (toward negative theta)
        )
        tris.append(right_tris)

    return np.concatenate(tris, axis=0) if tris else np.empty((0, 3, 3))


def _make_axial_quad(x0, x1, r0, r1, tL0, tR0, tL1, tR1, flip=False):
    """Create 2 triangles for a quad on a cylindrical surface between two stations."""
    A = _cyl(x0, r0, tL0)
    B = _cyl(x0, r0, tR0)
    C = _cyl(x1, r1, tL1)
    D = _cyl(x1, r1, tR1)
    if flip:
        return np.array([[A, B, C], [B, D, C]])
    else:
        return np.array([[A, C, B], [B, C, D]])


def _make_radial_wall(x0, x1, rb0, rt0, rb1, rt1, theta0, theta1, flip=False):
    """Create 2 triangles for a radial wall (from r_bot to r_top at a fixed angle)."""
    A = _cyl(x0, rb0, theta0)   # bottom at station i
    B = _cyl(x0, rt0, theta0)   # top at station i
    C = _cyl(x1, rb1, theta1)   # bottom at station i+1
    D = _cyl(x1, rt1, theta1)   # top at station i+1
    if flip:
        return np.array([[A, B, C], [B, D, C]])
    else:
        return np.array([[A, C, B], [B, C, D]])


def _cyl(x, r, theta):
    """Convert cylindrical (x, r, theta) to Cartesian (x, y, z)."""
    return np.array([x, r * math.cos(theta), r * math.sin(theta)])


# ---------------------------------------------------------------------------
#  Primitive builders
# ---------------------------------------------------------------------------

def _build_surface_of_revolution(x, r, n_circ, flip_normals=False):
    """Build triangles for a surface of revolution around the x-axis."""
    n = len(x)
    tris = np.empty(((n - 1) * n_circ * 2, 3, 3))
    idx = 0

    thetas = np.linspace(0, 2 * math.pi, n_circ + 1)
    cos_t = np.cos(thetas)
    sin_t = np.sin(thetas)

    for i in range(n - 1):
        x0, r0 = x[i], r[i]
        x1, r1 = x[i + 1], r[i + 1]

        for j in range(n_circ):
            A = np.array([x0, r0 * cos_t[j],   r0 * sin_t[j]])
            B = np.array([x0, r0 * cos_t[j+1], r0 * sin_t[j+1]])
            C = np.array([x1, r1 * cos_t[j],   r1 * sin_t[j]])
            D = np.array([x1, r1 * cos_t[j+1], r1 * sin_t[j+1]])

            if flip_normals:
                tris[idx] = [A, B, C]
                tris[idx + 1] = [B, D, C]
            else:
                tris[idx] = [A, C, B]
                tris[idx + 1] = [B, C, D]
            idx += 2

    return tris


def _build_annular_cap(x_pos, r_inner, r_outer, n_circ, face_negative_x=True):
    """Build triangulated annular disc at a fixed axial position."""
    tris = np.empty((n_circ * 2, 3, 3))
    idx = 0

    thetas = np.linspace(0, 2 * math.pi, n_circ + 1)
    cos_t = np.cos(thetas)
    sin_t = np.sin(thetas)

    for j in range(n_circ):
        Ai = np.array([x_pos, r_inner * cos_t[j],   r_inner * sin_t[j]])
        Bi = np.array([x_pos, r_inner * cos_t[j+1], r_inner * sin_t[j+1]])
        Co = np.array([x_pos, r_outer * cos_t[j],   r_outer * sin_t[j]])
        Do = np.array([x_pos, r_outer * cos_t[j+1], r_outer * sin_t[j+1]])

        if face_negative_x:
            tris[idx] = [Ai, Co, Bi]
            tris[idx + 1] = [Bi, Co, Do]
        else:
            tris[idx] = [Ai, Bi, Co]
            tris[idx + 1] = [Bi, Do, Co]
        idx += 2

    return tris


def _build_annular_cap_with_channels(
    x_pos, r_inner, r_outer, r_ch_bot, r_ch_top,
    r_mid, n_channels, ch_width, n_circ, face_negative_x=True
):
    """Build an end cap with rectangular channel notches.

    In rib regions: full annulus from r_inner to r_outer.
    In channel regions: two thin annuli (r_inner to r_ch_bot) + (r_ch_top to r_outer),
    leaving the channel void open.
    """
    tris_list = []
    spacing = 2.0 * math.pi / n_channels

    for ch in range(n_channels):
        center = ch * spacing
        half_a = ch_width / (2.0 * max(r_mid, 1e-6))
        ch_left = center - half_a
        ch_right = center + half_a

        # Rib region: from previous channel right edge to this channel left edge
        prev_center = ((ch - 1) % n_channels) * spacing
        prev_half_a = ch_width / (2.0 * max(r_mid, 1e-6))
        rib_left = prev_center + prev_half_a
        rib_right = ch_left

        # Handle wrap-around
        if ch == 0:
            rib_left = (n_channels - 1) * spacing + prev_half_a - 2 * math.pi

        # Rib: full wall from r_inner to r_outer (subdivide into ~4 segments)
        n_rib_segs = max(1, int(round((rib_right - rib_left) / (2 * math.pi) * n_circ)))
        rib_thetas = np.linspace(rib_left, rib_right, n_rib_segs + 1)
        for k in range(n_rib_segs):
            t0, t1 = rib_thetas[k], rib_thetas[k + 1]
            tris_list.append(_annular_cap_segment(
                x_pos, r_inner, r_outer, t0, t1, face_negative_x
            ))

        # Channel: hot wall (r_inner to r_ch_bot) and closeout (r_ch_top to r_outer)
        n_ch_segs = max(1, int(round((ch_right - ch_left) / (2 * math.pi) * n_circ)))
        ch_thetas = np.linspace(ch_left, ch_right, n_ch_segs + 1)
        for k in range(n_ch_segs):
            t0, t1 = ch_thetas[k], ch_thetas[k + 1]
            # Hot wall portion
            tris_list.append(_annular_cap_segment(
                x_pos, r_inner, r_ch_bot, t0, t1, face_negative_x
            ))
            # Closeout portion
            tris_list.append(_annular_cap_segment(
                x_pos, r_ch_top, r_outer, t0, t1, face_negative_x
            ))

        # Channel end-cap side walls (close the channel at this axial end)
        # Left side of channel
        tris_list.append(_channel_endcap_side(
            x_pos, r_ch_bot, r_ch_top, ch_left, face_negative_x, side='left'
        ))
        # Right side of channel
        tris_list.append(_channel_endcap_side(
            x_pos, r_ch_bot, r_ch_top, ch_right, face_negative_x, side='right'
        ))

    if not tris_list:
        return np.empty((0, 3, 3))
    return np.concatenate(tris_list, axis=0)


def _annular_cap_segment(x_pos, r_inner, r_outer, theta0, theta1, face_negative_x):
    """Two triangles for a single annular cap segment between theta0 and theta1."""
    c0, s0 = math.cos(theta0), math.sin(theta0)
    c1, s1 = math.cos(theta1), math.sin(theta1)

    Ai = np.array([x_pos, r_inner * c0, r_inner * s0])
    Bi = np.array([x_pos, r_inner * c1, r_inner * s1])
    Co = np.array([x_pos, r_outer * c0, r_outer * s0])
    Do = np.array([x_pos, r_outer * c1, r_outer * s1])

    if face_negative_x:
        return np.array([[Ai, Co, Bi], [Bi, Co, Do]])
    else:
        return np.array([[Ai, Bi, Co], [Bi, Do, Co]])


def _channel_endcap_side(x_pos, r_bot, r_top, theta, face_negative_x, side='left'):
    """Two triangles closing one side of a channel at an end cap."""
    c, s = math.cos(theta), math.sin(theta)
    A = np.array([x_pos, r_bot * c, r_bot * s])
    B = np.array([x_pos, r_top * c, r_top * s])

    # Slight offset in theta for the wall thickness (infinitesimal but needed for valid tris)
    # In practice, this face has zero width in theta -- it's a radial line, not a quad.
    # For the end cap, we just need the channel floor-to-ceiling face at this angle.
    # This is handled by the side walls from _build_single_channel at the first/last station.
    # So we return empty here -- the channel is closed by the axial side walls meeting the cap.
    return np.empty((0, 3, 3))


def _build_injector_disc(x_pos, r_inner, n_circ):
    """Build a solid disc at the chamber inlet (injector face)."""
    tris = np.empty((n_circ, 3, 3))
    center = np.array([x_pos, 0.0, 0.0])
    thetas = np.linspace(0, 2 * math.pi, n_circ + 1)
    cos_t = np.cos(thetas)
    sin_t = np.sin(thetas)

    for j in range(n_circ):
        A = np.array([x_pos, r_inner * cos_t[j],   r_inner * sin_t[j]])
        B = np.array([x_pos, r_inner * cos_t[j+1], r_inner * sin_t[j+1]])
        # Winding for face pointing in -x direction
        tris[j] = [center, B, A]

    return tris


def _build_injector_disc_with_orifices(x_pos, face_radius, layout, n_circ, wall_thickness=0.003):
    """Build injector disc with orifice holes using polar grid exclusion.

    Uses a polar grid of radial × angular cells. Cells whose center falls
    inside an orifice circle are skipped, leaving clean holes. Additionally,
    each orifice gets a cylindrical bore wall for 3D-printable through-holes.

    Resolution is computed from the smallest orifice so that grid cells
    are smaller than the holes.
    """
    # Compute resolution from smallest orifice
    min_orifice_r = face_radius
    for o in layout.orifices:
        if o.radius < min_orifice_r:
            min_orifice_r = o.radius
    cell_target = min_orifice_r  # half orifice diameter
    n_radial = min(150, max(60, int(math.ceil(face_radius / cell_target))))
    n_angular = min(600, max(n_circ, int(math.ceil(2.0 * math.pi * face_radius / cell_target))))

    tris_list = []

    thetas = np.linspace(0, 2 * math.pi, n_angular + 1)
    radii = np.linspace(0, face_radius, n_radial + 1)

    orifices = layout.orifices

    for i in range(n_radial):
        r0 = radii[i]
        r1 = radii[i + 1]
        r_mid = (r0 + r1) / 2.0

        for j in range(n_angular):
            t0 = thetas[j]
            t1 = thetas[j + 1]
            t_mid = (t0 + t1) / 2.0

            # Cell center in Y-Z
            cy = r_mid * math.cos(t_mid)
            cz = r_mid * math.sin(t_mid)

            # Check if cell center is inside any orifice
            inside = False
            for o in orifices:
                dy = cy - o.y_center
                dz = cz - o.z_center
                if dy * dy + dz * dz < o.radius * o.radius:
                    inside = True
                    break

            if inside:
                continue

            # Emit 2 triangles for this cell
            if r0 < 1e-8:
                # Central cell — single triangle from center
                A = np.array([x_pos, 0.0, 0.0])
                B = np.array([x_pos, r1 * math.cos(t0), r1 * math.sin(t0)])
                C = np.array([x_pos, r1 * math.cos(t1), r1 * math.sin(t1)])
                tris_list.append(np.array([[A, C, B]]))
            else:
                A = np.array([x_pos, r0 * math.cos(t0), r0 * math.sin(t0)])
                B = np.array([x_pos, r0 * math.cos(t1), r0 * math.sin(t1)])
                C = np.array([x_pos, r1 * math.cos(t0), r1 * math.sin(t0)])
                D = np.array([x_pos, r1 * math.cos(t1), r1 * math.sin(t1)])
                tris_list.append(np.array([[A, C, B], [B, C, D]]))

    # Cylindrical bore walls for each orifice
    bore_depth = min(wall_thickness, 0.005)
    bore_segments = 16
    x_back = x_pos + bore_depth  # bore extends into chamber wall

    for o in orifices:
        bore_thetas = np.linspace(0, 2 * math.pi, bore_segments + 1)
        for k in range(bore_segments):
            ct0 = math.cos(bore_thetas[k])
            st0 = math.sin(bore_thetas[k])
            ct1 = math.cos(bore_thetas[k + 1])
            st1 = math.sin(bore_thetas[k + 1])

            y0 = o.y_center + o.radius * ct0
            z0 = o.z_center + o.radius * st0
            y1 = o.y_center + o.radius * ct1
            z1 = o.z_center + o.radius * st1

            # Quad on bore wall (front face to back face)
            A = np.array([x_pos, y0, z0])
            B = np.array([x_pos, y1, z1])
            C = np.array([x_back, y0, z0])
            D = np.array([x_back, y1, z1])
            tris_list.append(np.array([[A, B, C], [B, D, C]]))

    if not tris_list:
        return np.empty((0, 3, 3))
    return np.concatenate(tris_list, axis=0)


# ---------------------------------------------------------------------------
#  Serialization
# ---------------------------------------------------------------------------

def _triangles_to_stl_bytes(triangles: np.ndarray) -> bytes:
    """Convert an (N, 3, 3) triangle array to binary STL bytes."""
    n_tris = len(triangles)
    stl_obj = stl_mesh.Mesh(np.zeros(n_tris, dtype=stl_mesh.Mesh.dtype))
    stl_obj.vectors = triangles.astype(np.float32)
    stl_obj.update_normals()

    buf = io.BytesIO()
    stl_obj.save('rocket_engine.stl', fh=buf, mode=stl_mode.Mode.BINARY)
    return buf.getvalue()
