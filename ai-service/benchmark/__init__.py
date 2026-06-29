"""
GetFit Benchmark Framework (isolated from production).

This package downloads public food datasets (Food-101 first), runs the
existing GetFit recognition pipeline over them, and measures accuracy.
It NEVER imports or mutates production modules — it calls the running
service over HTTP and writes results to its own folders.
"""

__version__ = "1.0.0"
