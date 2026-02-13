"""Nozzle contour generation: convergent section, Rao bell, and Bezier curves."""

import numpy as np
import math


def convergent_section(r_chamber: float, r_throat: float, half_angle_deg: float,
                       r_upstream_ratio: float, num_points: int = 40) -> np.ndarray:
    """Generate the convergent section from chamber to throat.
    
    Uses a straight cone with a circular arc blend at the throat entrance.
    Returns array of shape (num_points, 2) with columns [x, r].
    x=0 is at the start of the convergent section.
    """
    half_angle = math.radians(half_angle_deg)
    r_arc = r_upstream_ratio * r_throat  # radius of curvature at throat entrance
    
    # The arc tangent point on the cone
    # Arc center is at (x_center, r_throat + r_arc)
    # The arc blends from the cone line to the throat
    
    # Length of straight cone (before arc takes over)
    # Cone goes from r_chamber down to where the arc starts
    # Arc starts where the cone intersects the arc tangent circle
    
    # Arc tangent point on cone:
    delta_r_cone = r_chamber - r_throat
    cone_length = delta_r_cone / math.tan(half_angle)
    
    # The arc center is at x_throat, y = r_throat + r_arc
    # The tangent point on the cone from the arc:
    x_tangent_offset = r_arc * math.sin(half_angle)
    r_tangent = r_throat + r_arc - r_arc * math.cos(half_angle)
    
    # Straight cone portion
    straight_length = cone_length - x_tangent_offset
    if straight_length < 0:
        straight_length = 0
    
    points = []
    n_straight = max(num_points // 2, 5)
    n_arc = num_points - n_straight
    
    # Straight cone section
    for i in range(n_straight):
        t = i / max(n_straight - 1, 1)
        x = t * straight_length
        r = r_chamber - x * math.tan(half_angle)
        points.append([x, r])
    
    # Circular arc blending into throat
    for i in range(n_arc):
        t = i / max(n_arc - 1, 1)
        angle = math.pi / 2 + half_angle - t * (math.pi / 2 + half_angle)
        # Arc center at (straight_length + x_tangent_offset, r_throat + r_arc)
        x_center = cone_length
        y_center = r_throat + r_arc
        x = x_center - r_arc * math.sin(angle - math.pi / 2 + half_angle)
        # Remap: at t=0, angle gives start of arc; at t=1, angle=0 gives throat
        theta = half_angle * (1 - t)
        x = cone_length - r_arc * math.sin(theta)
        r = r_throat + r_arc * (1 - math.cos(theta))
        points.append([x, r])
    
    return np.array(points)


def rao_bell_nozzle(r_throat: float, expansion_ratio: float, bell_fraction: float = 80.0,
                    r_downstream_ratio: float = 0.4, num_points: int = 80) -> np.ndarray:
    """Generate a Rao-type bell nozzle divergent section.
    
    Uses a parabolic approximation with cubic Bezier curves.
    Returns array of shape (num_points, 2) with columns [x, r].
    x=0 is at the throat.
    """
    r_exit = r_throat * math.sqrt(expansion_ratio)
    r_arc_d = r_downstream_ratio * r_throat  # downstream throat arc radius
    
    # Initial and exit angles (empirical Rao approximations)
    # theta_n: initial expansion angle after throat
    # theta_e: exit angle
    if expansion_ratio <= 5:
        theta_n = math.radians(28.0 - 1.0 * (expansion_ratio - 2))
        theta_e = math.radians(12.0 - 1.5 * (expansion_ratio - 2))
    elif expansion_ratio <= 20:
        theta_n = math.radians(25.0 + 0.2 * (expansion_ratio - 5))
        theta_e = math.radians(8.0 - 0.3 * (expansion_ratio - 5))
    else:
        theta_n = math.radians(28.0 + 0.05 * (expansion_ratio - 20))
        theta_e = math.radians(4.0 - 0.02 * (expansion_ratio - 20))
    
    theta_n = max(theta_n, math.radians(10))
    theta_e = max(theta_e, math.radians(2))
    
    # Bell nozzle length (fraction of equivalent 15-deg cone)
    cone_length_15 = (r_exit - r_throat) / math.tan(math.radians(15))
    bell_length = (bell_fraction / 100.0) * cone_length_15
    
    # Start point: end of downstream throat arc
    x_start = r_arc_d * math.sin(theta_n)
    r_start = r_throat + r_arc_d * (1 - math.cos(theta_n))
    
    # End point
    x_end = bell_length
    r_end = r_exit
    
    # Cubic Bezier control points matching tangent angles
    # P0 = (x_start, r_start), tangent direction = (cos(theta_n), sin(theta_n))
    # P3 = (x_end, r_end), tangent direction = (cos(theta_e), sin(theta_e))
    dx = x_end - x_start
    
    # Control point distances along tangent lines
    t1 = dx * 0.4
    t2 = dx * 0.4
    
    p0 = np.array([x_start, r_start])
    p1 = p0 + t1 * np.array([math.cos(theta_n), math.sin(theta_n)])
    p3 = np.array([x_end, r_end])
    p2 = p3 - t2 * np.array([math.cos(theta_e), math.sin(theta_e)])
    
    # Generate Bezier curve
    points = []
    for i in range(num_points):
        t = i / max(num_points - 1, 1)
        pt = ((1 - t) ** 3 * p0 +
              3 * (1 - t) ** 2 * t * p1 +
              3 * (1 - t) * t ** 2 * p2 +
              t ** 3 * p3)
        points.append(pt)
    
    return np.array(points)


def cubic_bezier_contour(control_points: list, num_points: int = 80) -> np.ndarray:
    """Generate a cubic Bezier curve from 4 control points.
    
    control_points: list of 4 [x, y] pairs
    Returns array of shape (num_points, 2).
    """
    cp = np.array(control_points)
    points = []
    for i in range(num_points):
        t = i / max(num_points - 1, 1)
        pt = ((1 - t) ** 3 * cp[0] +
              3 * (1 - t) ** 2 * t * cp[1] +
              3 * (1 - t) * t ** 2 * cp[2] +
              t ** 3 * cp[3])
        points.append(pt)
    return np.array(points)


def full_engine_contour(chamber_diameter: float, chamber_length: float,
                        throat_diameter: float, expansion_ratio: float,
                        convergence_half_angle: float,
                        throat_upstream_radius_ratio: float,
                        throat_downstream_radius_ratio: float,
                        bell_fraction: float,
                        contour_cp1_y: float = 0.5,
                        contour_cp2_y: float = 0.5,
                        num_stations: int = 200) -> np.ndarray:
    """Build the complete engine inner-wall contour.
    
    Returns array of shape (num_stations, 3): [x, r_inner, zone_id]
    zone_id: 0=chamber, 1=convergent, 2=throat_arc, 3=divergent
    """
    r_chamber = chamber_diameter / 2
    r_throat = throat_diameter / 2
    
    # Allocate stations per zone
    n_chamber = max(num_stations // 8, 10)
    n_convergent = max(num_stations // 4, 20)
    n_divergent = num_stations - n_chamber - n_convergent
    
    all_points = []
    
    # Zone 0: Combustion chamber (cylindrical)
    for i in range(n_chamber):
        t = i / max(n_chamber - 1, 1)
        x = t * chamber_length
        all_points.append([x, r_chamber, 0])
    
    # Zone 1+2: Convergent section to throat
    conv = convergent_section(r_chamber, r_throat, convergence_half_angle,
                              throat_upstream_radius_ratio, n_convergent)
    x_offset = chamber_length
    for i, (cx, cr) in enumerate(conv):
        zone = 1 if i < len(conv) * 0.7 else 2
        all_points.append([cx + x_offset, cr, zone])
    
    # Zone 3: Divergent nozzle (Rao bell)
    throat_x = all_points[-1][0]
    div = rao_bell_nozzle(r_throat, expansion_ratio, bell_fraction,
                          throat_downstream_radius_ratio, n_divergent)
    for dx, dr in div:
        all_points.append([dx + throat_x, dr, 3])
    
    result = np.array(all_points)
    
    # Ensure monotonically increasing x
    for i in range(1, len(result)):
        if result[i, 0] <= result[i - 1, 0]:
            result[i, 0] = result[i - 1, 0] + 1e-6
    
    return result
