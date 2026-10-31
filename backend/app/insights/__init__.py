"""Aditya's module (ml/, data/, backend/app/insights/).

All /api/insights/* routes live here. Ayaan only provides the skeleton:
the APIRouter is mounted in main.py and clear_fault() is the single hook
the tickets module calls when a fix is marked complete.
"""

from .faults import clear_fault as clear_injected_fault
from .router import clear_fault, router

__all__ = ["router", "clear_fault", "clear_injected_fault"]
