from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from milady.build_training_dataset import main


if __name__ == "__main__":
    main()
