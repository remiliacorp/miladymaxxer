from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from milady.ingest_avatar_exports import main


if __name__ == "__main__":
    main()
