#!/usr/bin/env python3
"""Stable process entry point for the local solver bundle."""
import sys
from solver_core.service import solve_json

if __name__ == '__main__':
    print(solve_json(sys.stdin.read()))
