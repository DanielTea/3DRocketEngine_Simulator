"""Population initialization and diversity tracking."""

import numpy as np
from scipy.stats import qmc
from backend.config import GENOME_BOUNDS


def initialize_population_lhs(size: int, bounds=GENOME_BOUNDS) -> list:
    """Initialize population using Latin Hypercube Sampling.
    
    Provides good coverage of the genome space.
    Returns list of genome vectors (list of floats).
    """
    d = len(bounds)
    sampler = qmc.LatinHypercube(d=d)
    sample = sampler.random(n=size)
    
    l_bounds = [b[0] for b in bounds]
    u_bounds = [b[1] for b in bounds]
    
    scaled = qmc.scale(sample, l_bounds, u_bounds)
    
    return [list(row) for row in scaled]


def diversity_metric(population) -> float:
    """Compute normalized average pairwise distance in genome space.
    
    Higher values = more diverse population.
    """
    if len(population) < 2:
        return 0.0
    
    genomes = np.array([list(ind) for ind in population])
    
    # Normalize each gene to [0, 1]
    bounds = np.array(GENOME_BOUNDS)
    ranges = bounds[:, 1] - bounds[:, 0]
    ranges[ranges == 0] = 1.0
    normalized = (genomes - bounds[:, 0]) / ranges
    
    # Sample pairs for efficiency (max 500 pairs)
    n = len(population)
    if n > 32:
        indices = np.random.choice(n, size=(500, 2), replace=True)
        diffs = normalized[indices[:, 0]] - normalized[indices[:, 1]]
        distances = np.sqrt(np.sum(diffs ** 2, axis=1))
    else:
        from scipy.spatial.distance import pdist
        distances = pdist(normalized)
    
    return float(np.mean(distances))


def inject_known_designs(population, presets: list):
    """Replace the first N individuals with known good designs.
    
    presets: list of genome vectors (list of floats)
    """
    for i, preset in enumerate(presets):
        if i < len(population):
            for j in range(len(preset)):
                population[i][j] = preset[j]
    return population
