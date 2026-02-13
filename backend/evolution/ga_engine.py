"""Genetic algorithm engine using DEAP for rocket engine shape optimization."""

import random
import asyncio
import numpy as np
from deap import base, creator, tools
from backend.config import GENOME_BOUNDS, GENE_NAMES
from backend.evolution.operators import blx_alpha_crossover, gaussian_mutation, feasibility_repair
from backend.evolution.population import initialize_population_lhs, diversity_metric
from backend.evolution.fitness import FitnessEvaluator


# DEAP creator setup (module-level, only once)
if not hasattr(creator, "FitnessMax"):
    creator.create("FitnessMax", base.Fitness, weights=(1.0,))
if not hasattr(creator, "Individual"):
    creator.create("Individual", list, fitness=creator.FitnessMax)


class EvolutionRunner:
    """Runs the genetic algorithm for engine optimization."""
    
    def __init__(self, population_size: int, num_generations: int,
                 crossover_prob: float, mutation_prob: float,
                 evaluator: FitnessEvaluator,
                 on_generation=None):
        self.pop_size = population_size
        self.num_gen = num_generations
        self.cx_prob = crossover_prob
        self.mut_prob = mutation_prob
        self.evaluator = evaluator
        self.on_generation = on_generation
        
        # Setup DEAP toolbox
        self.toolbox = base.Toolbox()
        self.toolbox.register("mate", blx_alpha_crossover)
        self.toolbox.register("select", tools.selTournament, tournsize=3)
    
    def _create_individual(self, genome):
        ind = creator.Individual(genome)
        return ind
    
    def _evaluate(self, individual):
        result = self.evaluator.evaluate(list(individual))
        return (result["total"],)
    
    async def run_async(self, should_continue=None) -> dict:
        """Run the GA asynchronously, yielding control between generations.
        
        should_continue: callable that returns True to keep running.
        Returns dict with best result.
        """
        if should_continue is None:
            should_continue = lambda: True
        
        # Initialize population with LHS
        genomes = initialize_population_lhs(self.pop_size)
        population = [self._create_individual(g) for g in genomes]
        
        # Evaluate initial population
        for ind in population:
            ind.fitness.values = self._evaluate(ind)
        
        n_elite = max(1, int(self.pop_size * 0.05))
        best_ever = None
        best_ever_fitness = -float('inf')
        stagnation = 0
        
        for gen in range(self.num_gen):
            if not should_continue():
                break
            
            # Selection
            offspring = self.toolbox.select(population, self.pop_size - n_elite)
            offspring = [self._create_individual(list(ind)) for ind in offspring]
            
            # Crossover
            for i in range(0, len(offspring) - 1, 2):
                if random.random() < self.cx_prob:
                    self.toolbox.mate(offspring[i], offspring[i + 1])
                    del offspring[i].fitness.values
                    del offspring[i + 1].fitness.values
            
            # Mutation
            for i in range(len(offspring)):
                if random.random() < self.mut_prob:
                    gaussian_mutation(offspring[i], generation=gen, max_generations=self.num_gen)
                    del offspring[i].fitness.values
            
            # Evaluate new individuals
            for ind in offspring:
                if not ind.fitness.valid:
                    ind.fitness.values = self._evaluate(ind)
            
            # Elitism
            elites = tools.selBest(population, n_elite)
            elites = [self._create_individual(list(e)) for e in elites]
            for e in elites:
                e.fitness.values = self._evaluate(e)
            
            population = elites + offspring
            
            # Statistics
            fits = [ind.fitness.values[0] for ind in population]
            best_ind = tools.selBest(population, 1)[0]
            best_fit = best_ind.fitness.values[0]
            
            if best_fit > best_ever_fitness:
                best_ever_fitness = best_fit
                best_ever = list(best_ind)
                best_ever_result = self.evaluator.evaluate(best_ever)
                stagnation = 0
            else:
                stagnation += 1
            
            # Build snapshot
            snapshot = {
                "generation": gen,
                "best_fitness": float(best_fit),
                "avg_fitness": float(np.mean(fits)),
                "worst_fitness": float(np.min(fits)),
                "diversity": diversity_metric(population),
                "best_genome": dict(zip(GENE_NAMES, [float(g) for g in best_ind])),
                "best_scores": best_ever_result.get("scores", {}) if best_ever_result else {},
                "population_size": len(population),
                "stagnation": stagnation,
            }
            
            # Callback
            if self.on_generation:
                await self.on_generation(snapshot)
            
            # Yield control to event loop
            await asyncio.sleep(0)
            
            # Early termination on convergence
            if stagnation > 20 and gen > 30:
                break
        
        # Final result
        best_result = self.evaluator.evaluate(best_ever) if best_ever else {}
        return {
            "total_generations": gen + 1 if 'gen' in dir() else 0,
            "best_genome": dict(zip(GENE_NAMES, [float(g) for g in best_ever])) if best_ever else {},
            "best_fitness": float(best_ever_fitness),
            "best_scores": best_result.get("scores", {}),
            "best_performance": best_result.get("performance", {}),
            "reason": "stagnation" if stagnation > 20 else "max_generations_reached",
        }
