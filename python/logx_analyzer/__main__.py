import os
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logx_analyzer.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
