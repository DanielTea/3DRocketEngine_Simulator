"""Thermophysical properties for rocket engine coolants.

Provides temperature-dependent properties for RP-1 (kerosene) and LCH4
(liquid methane) using polynomial fits valid over typical operating ranges.
"""

import math


class CoolantRP1:
    """RP-1 kerosene properties. Valid ~290-750 K."""

    @staticmethod
    def density(T):
        """kg/m^3"""
        return max(400.0, 1020.0 - 0.58 * T)

    @staticmethod
    def specific_heat(T):
        """J/(kg*K)"""
        return 2010.0 + 3.6 * T

    @staticmethod
    def viscosity(T):
        """Pa*s"""
        return max(1e-5, 2.4e-3 * math.exp(-0.018 * (T - 300.0)))

    @staticmethod
    def conductivity(T):
        """W/(m*K)"""
        return max(0.04, 0.12 - 4.5e-5 * T)

    @staticmethod
    def prandtl(T):
        """Dimensionless."""
        cp = CoolantRP1.specific_heat(T)
        mu = CoolantRP1.viscosity(T)
        k = CoolantRP1.conductivity(T)
        return cp * mu / k if k > 0 else 10.0


class CoolantLCH4:
    """Liquid methane properties. Valid ~111-500 K."""

    @staticmethod
    def density(T):
        """kg/m^3"""
        return max(100.0, 520.0 - 0.9 * T)

    @staticmethod
    def specific_heat(T):
        """J/(kg*K)"""
        return 3400.0 + 2.5 * T

    @staticmethod
    def viscosity(T):
        """Pa*s"""
        return max(5e-6, 1.8e-4 * math.exp(-0.012 * (T - 111.0)))

    @staticmethod
    def conductivity(T):
        """W/(m*K)"""
        return max(0.02, 0.19 - 2e-4 * T)

    @staticmethod
    def prandtl(T):
        """Dimensionless."""
        cp = CoolantLCH4.specific_heat(T)
        mu = CoolantLCH4.viscosity(T)
        k = CoolantLCH4.conductivity(T)
        return cp * mu / k if k > 0 else 5.0


COOLANTS = {
    "rp1": CoolantRP1,
    "lch4": CoolantLCH4,
}


def get_coolant(name: str):
    """Get coolant class by name."""
    return COOLANTS.get(name.lower(), CoolantRP1)
