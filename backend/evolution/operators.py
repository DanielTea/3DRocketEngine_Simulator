"""Custom genetic algorithm operators for engine geometry evolution."""

import random
import math
import numpy as np
from backend.config import GENOME_BOUNDS


def feasibility_repair(individual, bounds=GENOME_BOUNDS):
    """Clamp each gene to its feasible bounds and enforce geometric constraints."""
    for i in range(min(len(individual), len(bounds))):
        lo, hi = bounds[i]
        individual[i] = max(lo, min(hi, individual[i]))

    # Constraint: throat_diameter (gene 2) < chamber_diameter (gene 0)
    if individual[2] >= individual[0]:
        individual[2] = individual[0] * 0.6

    # Constraint: chamber_length >= chamber_diameter * 0.5
    min_length = individual[0] * 0.5
    if individual[1] < min_length:
        individual[1] = min_length

    # Wall thickness constraints (genes 4-9): adjacent CPs within 3x ratio
    for i in range(4, 9):
        if individual[i + 1] > 0 and individual[i] / individual[i + 1] > 3.0:
            avg = (individual[i] + individual[i + 1]) / 2.0
            individual[i] = avg * 1.3
            individual[i + 1] = avg * 0.7
        elif individual[i] > 0 and individual[i + 1] / individual[i] > 3.0:
            avg = (individual[i] + individual[i + 1]) / 2.0
            individual[i] = avg * 0.7
            individual[i + 1] = avg * 1.3

    # Cooling channel constraints (genes 16-21, if genome is long enough)
    if len(individual) >= 22:
        # n_channels (gene 16) — round to integer
        individual[16] = round(individual[16])

        # channel_height must be <= min wall thickness * 0.8
        min_wt = min(individual[4:10])
        max_channel_height = min_wt * 0.8
        if individual[18] > max_channel_height:
            individual[18] = max(max_channel_height, bounds[18][0])

        # Total channel width must be <= 85% of throat circumference
        throat_circumference = math.pi * individual[2]  # throat_diameter
        total_channel_width = individual[16] * individual[17]  # n_channels * channel_width
        if total_channel_width > 0.85 * throat_circumference:
            # Reduce n_channels or channel_width
            max_width = 0.85 * throat_circumference / max(individual[16], 1)
            individual[17] = max(min(individual[17], max_width), bounds[17][0])

    # Channel height CP constraints (genes 22-24)
    if len(individual) >= 25:
        min_wt = min(individual[4:10])
        max_ch = min_wt * 0.8
        for gi in range(22, 25):
            individual[gi] = max(min(individual[gi], max_ch), bounds[gi][0])

        # Adjacent CPs within 3x ratio for smooth interpolation
        for gi in range(22, 24):
            if individual[gi + 1] > 0 and individual[gi] / individual[gi + 1] > 3.0:
                avg = (individual[gi] + individual[gi + 1]) / 2.0
                individual[gi] = avg * 1.3
                individual[gi + 1] = avg * 0.7
            elif individual[gi] > 0 and individual[gi + 1] / individual[gi] > 3.0:
                avg = (individual[gi] + individual[gi + 1]) / 2.0
                individual[gi] = avg * 0.7
                individual[gi + 1] = avg * 1.3

    return individual


def blx_alpha_crossover(ind1, ind2, alpha=0.5):
    """BLX-alpha crossover: blend genes with exploration range."""
    for i in range(len(ind1)):
        lo = min(ind1[i], ind2[i])
        hi = max(ind1[i], ind2[i])
        spread = alpha * (hi - lo)
        ind1[i] = random.uniform(lo - spread, hi + spread)
        ind2[i] = random.uniform(lo - spread, hi + spread)

    feasibility_repair(ind1)
    feasibility_repair(ind2)
    return ind1, ind2


def gaussian_mutation(individual, sigma_fraction=0.1, indpb=0.2, generation=0, max_generations=100):
    """Per-gene Gaussian mutation with adaptive sigma."""
    decay = 1.0 - 0.9 * (generation / max(max_generations, 1))

    for i in range(min(len(individual), len(GENOME_BOUNDS))):
        if random.random() < indpb:
            lo, hi = GENOME_BOUNDS[i]
            gene_range = hi - lo
            sigma = sigma_fraction * gene_range * decay
            individual[i] += random.gauss(0, sigma)

    feasibility_repair(individual)
    return (individual,)
