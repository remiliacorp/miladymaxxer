from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path

import torch

from .mobilenet_common import DatasetEntry, compute_metrics, create_model, load_dataset_entries, probabilities_from_model
from .pipeline_common import MODEL_COMPARE_ROOT, MODEL_RUN_ROOT, SPLIT_MANIFEST_PATH, SPLIT_ROOT, connect_offline_cache_db, ensure_layout, read_json_file

HEADLINE_EVAL_POLICY = "manual_export_gold_only"
ALL_MANUAL_EVAL_POLICY = "all_manual_export_labels"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare trained classifier checkpoints on the current dataset splits.")
    parser.add_argument("--run-id", dest="run_ids", action="append", required=True, help="Run ID to compare. Pass multiple times.")
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--cpu", action="store_true", help="Force CPU evaluation.")
    parser.add_argument("--output-dir", type=Path, help="Optional output directory. Defaults under cache/models/.../compare.")
    parser.add_argument(
        "--eval-set",
        choices=("blind", "all-manual"),
        default="blind",
        help="Evaluation population: blind val/test splits, or all deduped manually labeled exported avatars.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_ids = dedupe(args.run_ids)
    if len(run_ids) < 2:
        raise SystemExit("Pass at least two --run-id values.")

    ensure_layout()
    output_dir = args.output_dir or default_output_dir(run_ids)
    output_dir.mkdir(parents=True, exist_ok=True)

    device = choose_device(args.cpu)
    cache_connection = connect_offline_cache_db()
    try:
        val_entries, test_entries, evaluation_policy = load_evaluation_entries(args.eval_set)
        if not val_entries or not test_entries:
            raise SystemExit("Missing evaluation entries. Run `uv run milady build-dataset` first.")
        print(
            f"[compare] device={device.type} runs={len(run_ids)} val={len(val_entries)} test={len(test_entries)}",
            flush=True,
        )
        print(f"[compare] output_dir={output_dir}", flush=True)

        results: dict[str, object] = {
            "generatedAt": datetime.now(UTC).isoformat(),
            "device": device.type,
            "valSize": len(val_entries),
            "testSize": len(test_entries),
            "evaluationPolicy": {
                "headline": evaluation_policy,
            },
            "runIds": run_ids,
            "runs": {},
        }

        for run_id in run_ids:
            summary_path = MODEL_RUN_ROOT / run_id / "summary.json"
            checkpoint_path = MODEL_RUN_ROOT / run_id / "best.pt"
            if not summary_path.exists() or not checkpoint_path.exists():
                raise SystemExit(f"Missing summary or checkpoint for run {run_id}")
            print(f"[compare:{run_id}] loading checkpoint", flush=True)

            summary = json.loads(summary_path.read_text())
            precision_floor = float(summary["precisionFloor"])

            model = create_model(pretrained=False).to(device)
            state = torch.load(checkpoint_path, map_location=device)
            model.load_state_dict(state)

            print(f"[compare:{run_id}] evaluating validation split", flush=True)
            val_probabilities, val_labels = evaluate(model, val_entries, device, args.batch_size, cache_connection)
            threshold, val_metrics = choose_threshold(val_probabilities, val_labels, precision_floor)
            print(
                f"[compare:{run_id}] validation done threshold={threshold:.4f} "
                f"precision={val_metrics['precision']:.4f} recall={val_metrics['recall']:.4f}",
                flush=True,
            )
            print(f"[compare:{run_id}] evaluating test split", flush=True)
            test_probabilities, test_labels = evaluate(model, test_entries, device, args.batch_size, cache_connection)
            test_metrics = compute_metrics(test_probabilities, test_labels, threshold)

            false_positives = collect_errors(test_entries, test_probabilities, test_labels, threshold, want_predicted=1, want_label=0)
            false_negatives = collect_errors(test_entries, test_probabilities, test_labels, threshold, want_predicted=0, want_label=1)

            false_positives_path = output_dir / f"{run_id}.false_positives.json"
            false_negatives_path = output_dir / f"{run_id}.false_negatives.json"
            false_positives_path.write_text(json.dumps(false_positives, indent=2, sort_keys=True))
            false_negatives_path.write_text(json.dumps(false_negatives, indent=2, sort_keys=True))
            print(
                f"[compare:{run_id}] test done precision={test_metrics['precision']:.4f} "
                f"recall={test_metrics['recall']:.4f} fp={len(false_positives)} fn={len(false_negatives)}",
                flush=True,
            )

            results["runs"][run_id] = {
                "threshold": threshold,
                "precisionFloor": precision_floor,
                "valMetrics": val_metrics,
                "testMetrics": test_metrics,
                "valDiagnosticsBySource": diagnostic_metrics_by(val_entries, val_probabilities, threshold),
                "testDiagnosticsBySource": diagnostic_metrics_by(test_entries, test_probabilities, threshold),
                "falsePositiveCount": len(false_positives),
                "falseNegativeCount": len(false_negatives),
                "falsePositivesPath": str(false_positives_path),
                "falseNegativesPath": str(false_negatives_path),
            }

        summary_output = output_dir / "summary.json"
        summary_output.write_text(json.dumps(results, indent=2, sort_keys=True))
        print(json.dumps(results, indent=2, sort_keys=True))
        print(f"[saved] {summary_output}")
    finally:
        cache_connection.close()


def dedupe(run_ids: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for run_id in run_ids:
        if run_id in seen:
            continue
        seen.add(run_id)
        ordered.append(run_id)
    return ordered


def default_output_dir(run_ids: list[str]) -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    slug = "__".join(run_ids)
    return MODEL_COMPARE_ROOT / f"{stamp}__{slug}"


def load_evaluation_entries(eval_set: str) -> tuple[list, list, str]:
    if eval_set == "blind":
        val_entries = load_dataset_entries(SPLIT_ROOT / "val.jsonl")
        test_entries = load_dataset_entries(SPLIT_ROOT / "test.jsonl")
        return val_entries, test_entries, HEADLINE_EVAL_POLICY
    if eval_set == "all-manual":
        entries = load_all_manual_export_entries()
        return entries, entries, ALL_MANUAL_EVAL_POLICY
    raise SystemExit(f"Unknown eval set: {eval_set}")


def load_all_manual_export_entries() -> list:
    if not SPLIT_MANIFEST_PATH.exists():
        return []
    manifest = read_json_file(SPLIT_MANIFEST_PATH)
    groups = manifest.get("groups", [])
    entries = []
    for group in groups:
        canonical = group.get("canonical", {})
        if canonical.get("source") != "export":
            continue
        if canonical.get("labelSource") != "manual":
            continue
        label = str(group.get("label"))
        if label not in ("milady", "not_milady"):
            continue
        entries.append(
            DatasetEntry(
                sample_id=str(canonical["id"]),
                path=Path(str(canonical["path"])),
                label=label,
                source="export",
                split="all-manual",
                label_source="manual",
                label_tier=str(canonical.get("labelTier") or "gold"),
                sample_weight=float(canonical.get("sampleWeight", 1.0)),
            )
        )
    return entries


def choose_device(force_cpu: bool) -> torch.device:
    if force_cpu:
        return torch.device("cpu")
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def evaluate(
    model: torch.nn.Module,
    entries: list,
    device: torch.device,
    batch_size: int = 64,
    cache_connection=None,
) -> tuple[list[float], list[int]]:
    probabilities = probabilities_from_model(
        model,
        [entry.path for entry in entries],
        device,
        batch_size=batch_size,
        connection=cache_connection,
    ).tolist()
    labels = [1 if entry.label == "milady" else 0 for entry in entries]
    return probabilities, labels


def choose_threshold(probabilities: list[float], labels: list[int], precision_floor: float) -> tuple[float, dict[str, float]]:
    from .mobilenet_common import choose_threshold as choose_threshold_impl

    return choose_threshold_impl(probabilities, labels, precision_floor)


def collect_errors(
    entries,
    probabilities: list[float],
    labels: list[int],
    threshold: float,
    *,
    want_predicted: int,
    want_label: int,
) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    for entry, probability, label in zip(entries, probabilities, labels, strict=True):
        predicted = 1 if probability >= threshold else 0
        if predicted != want_predicted or label != want_label:
            continue
        items.append(
            {
                "id": entry.sample_id,
                "path": str(entry.path),
                "label": entry.label,
                "source": entry.source,
                "labelSource": entry.label_source,
                "labelTier": entry.label_tier,
                "split": entry.split,
                "probability": probability,
                "threshold": threshold,
                "predictedLabel": "milady" if predicted == 1 else "not_milady",
            }
        )
    return items


def diagnostic_metrics_by(entries, probabilities: list[float], threshold: float) -> dict[str, dict[str, dict[str, float] | int | str]]:
    diagnostics: dict[str, dict[str, dict[str, float] | int | str]] = {}
    groups = {
        "source": sorted({entry.source for entry in entries}),
        "labelSource": sorted({entry.label_source for entry in entries}),
        "labelTier": sorted({entry.label_tier for entry in entries}),
    }
    for group_name, values in groups.items():
        grouped_metrics: dict[str, dict[str, float] | int | str] = {}
        for value in values:
            indices = [
                index
                for index, entry in enumerate(entries)
                if getattr(entry, "source" if group_name == "source" else ("label_source" if group_name == "labelSource" else "label_tier")) == value
            ]
            if not indices:
                continue
            grouped_metrics[value] = {
                "count": len(indices),
                "metrics": compute_metrics([probabilities[index] for index in indices], [1 if entries[index].label == "milady" else 0 for index in indices], threshold),
            }
        diagnostics[group_name] = grouped_metrics
    return diagnostics


if __name__ == "__main__":
    main()
