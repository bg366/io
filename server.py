#!/usr/bin/env python3
import sys

from szrz.http import run


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        sys.exit(0)
