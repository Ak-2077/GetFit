"""
Pytest configuration for the ai-service test suite.

Ensures the `ai-service` directory (which contains the `app` package) is on
`sys.path` so tests can `import app...` regardless of the working directory
pytest is invoked from.
"""

import sys
from pathlib import Path

# ai-service/ is the parent of this tests/ directory.
AI_SERVICE_ROOT = Path(__file__).resolve().parent.parent
if str(AI_SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVICE_ROOT))
