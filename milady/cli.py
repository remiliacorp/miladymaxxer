from __future__ import annotations

import argparse
import importlib
import sys


COMMANDS: dict[str, tuple[str, str]] = {
    "review": ("milady.review_avatars", "Run the local review app."),
    "ingest": ("milady.ingest_avatar_exports", "Ingest exported avatar manifests into the local catalog."),
    "download-avatars": ("milady.download_avatar_catalog", "Download avatar images from the local catalog."),
    "download-derivatives": ("milady.download_derivative_samples", "Download positive samples from derivative collections."),
    "label-heuristic": ("milady.label_heuristic_matches", "Auto-label heuristic positives as milady."),
    "build-dataset": ("milady.build_training_dataset", "Materialize train/val/test splits."),
    "train": ("milady.train_classifier", "Train the MobileNetV3-Small classifier."),
    "compare": ("milady.compare_runs", "Compare trained checkpoints on the current dataset splits."),
    "export-errors": ("milady.export_compare_errors", "Export compare false positives and negatives as image folders."),
    "score": ("milady.score_avatar_catalog", "Score the local catalog with a trained classifier."),
    "export-onnx": ("milady.export_classifier_onnx", "Export a trained classifier to ONNX for the extension runtime."),
    "check-pfp": ("milady.check_pfp_url", "Score a single profile image URL or local image file."),
}


def build_parser() -> argparse.ArgumentParser:
    command_lines = "\n".join(f"  {name:<22} {help_text}" for name, (_, help_text) in sorted(COMMANDS.items()))
    parser = argparse.ArgumentParser(
        prog="milady",
        description="Milady Shrinkifier training and labeling toolkit.",
        epilog=f"Commands:\n{command_lines}",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("command", nargs="?", choices=sorted(COMMANDS.keys()))
    parser.add_argument("args", nargs=argparse.REMAINDER, help=argparse.SUPPRESS)
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    namespace = parser.parse_args(argv)
    if namespace.command is None:
        parser.print_help()
        return

    module_name, _ = COMMANDS[namespace.command]
    module = importlib.import_module(module_name)
    entrypoint = getattr(module, "main", None)
    if not callable(entrypoint):
        raise SystemExit(f"{module_name} does not expose a callable main()")

    previous_argv = sys.argv
    try:
        sys.argv = [f"milady {namespace.command}", *namespace.args]
        entrypoint()
    finally:
        sys.argv = previous_argv
