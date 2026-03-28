from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

from sklearn.model_selection import StratifiedGroupKFold

from .download_derivative_samples import COLLECTIONS as DERIVATIVE_COLLECTIONS
from .mobilenet_common import DatasetEntry, SPLIT_SEED, dataset_entries_to_jsonl
from .pipeline_common import (
    DERIVATIVE_MANIFEST_PATH,
    OFFICIAL_IMAGE_ROOT,
    SPLIT_MANIFEST_PATH,
    SPLIT_ROOT,
    connect_db,
    connect_offline_cache_db,
    get_file_fingerprint,
    now_iso,
    read_json_file,
    resolve_repo_path,
    sha256_bytes,
    write_json_file,
)

ENABLED_DERIVATIVE_SLUGS = frozenset(collection.slug for collection in DERIVATIVE_COLLECTIONS)
SOURCE_PRIORITY = {
    "export": 0,
    "derivative": 1,
    "official": 2,
}
LABEL_TIER_PRIORITY = {
    "gold": 0,
    "trusted": 1,
    "weak": 2,
}
WEAK_LABEL_WEIGHT = 0.35
GOLD_LABEL_SOURCE = "manual"


@dataclass(slots=True)
class SampleRecord:
    sample_id: str
    path: Path
    label: str
    source: str
    raw_sha: str
    pixel_digest: str
    label_source: str
    label_tier: str
    sample_weight: float
    blind_eval_eligible: bool
    exported_sha: str | None = None


@dataclass(slots=True)
class GroupRecord:
    group_id: str
    label: str
    split: str
    canonical: SampleRecord
    members: list[SampleRecord]
    blind_eval_eligible: bool


class UnionFind:
    def __init__(self, size: int) -> None:
        self.parent = list(range(size))
        self.rank = [0] * size

    def find(self, index: int) -> int:
        while self.parent[index] != index:
            self.parent[index] = self.parent[self.parent[index]]
            index = self.parent[index]
        return index

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return
        if self.rank[left_root] < self.rank[right_root]:
            self.parent[left_root] = right_root
        elif self.rank[left_root] > self.rank[right_root]:
            self.parent[right_root] = left_root
        else:
            self.parent[right_root] = left_root
            self.rank[left_root] += 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Materialize grouped train/val/test JSONL files for MobileNetV3-Small training.")
    parser.add_argument("--train-ratio", type=float, default=0.8)
    parser.add_argument("--val-ratio", type=float, default=0.1)
    parser.add_argument("--test-ratio", type=float, default=0.1)
    parser.add_argument("--reset-splits", action="store_true", help="Recompute all split assignments from scratch.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    connection = connect_db()
    cache_connection = connect_offline_cache_db()
    try:
        print("[build-dataset] collecting samples", flush=True)
        samples = build_sample_records(connection, cache_connection)
        print(f"[build-dataset] collected {len(samples)} samples", flush=True)
        print("[build-dataset] grouping duplicates", flush=True)
        groups = build_group_records(samples)
        print(f"[build-dataset] grouped into {len(groups)} image families", flush=True)
        print("[build-dataset] assigning splits", flush=True)
        assignments, manifest_mode = assign_group_splits(groups, args, SPLIT_MANIFEST_PATH)
        print(f"[build-dataset] split mode={manifest_mode}", flush=True)

        dataset_entries: list[DatasetEntry] = []
        exported_split_updates: dict[str, str] = {}
        manifest_groups: list[dict[str, object]] = []

        for group in groups:
            split = assignments[group.group_id]
            dataset_entries.append(
                DatasetEntry(
                    sample_id=group.canonical.sample_id,
                    path=group.canonical.path,
                    label=group.label,
                    source=group.canonical.source,
                    split=split,
                    label_source=group.canonical.label_source,
                    label_tier=group.canonical.label_tier,
                    sample_weight=group.canonical.sample_weight,
                )
            )
            for member in group.members:
                if member.exported_sha is not None:
                    exported_split_updates[member.exported_sha] = split
            manifest_groups.append(
                {
                    "groupId": group.group_id,
                    "label": group.label,
                    "split": split,
                    "canonical": {
                        "id": group.canonical.sample_id,
                        "path": str(group.canonical.path),
                        "source": group.canonical.source,
                        "labelSource": group.canonical.label_source,
                        "labelTier": group.canonical.label_tier,
                        "sampleWeight": group.canonical.sample_weight,
                        "blindEvalEligible": group.blind_eval_eligible,
                        "rawSha": group.canonical.raw_sha,
                        "pixelDigest": group.canonical.pixel_digest,
                    },
                    "members": [
                        {
                            "id": member.sample_id,
                            "path": str(member.path),
                            "source": member.source,
                            "labelSource": member.label_source,
                            "labelTier": member.label_tier,
                            "sampleWeight": member.sample_weight,
                            "blindEvalEligible": member.blind_eval_eligible,
                            "rawSha": member.raw_sha,
                            "pixelDigest": member.pixel_digest,
                            "exportedSha": member.exported_sha,
                        }
                        for member in sorted(group.members, key=lambda item: item.sample_id)
                    ],
                }
            )

        for exported_sha, split in exported_split_updates.items():
            connection.execute(
                "UPDATE images SET split = ?, updated_at = CURRENT_TIMESTAMP WHERE sha256 = ?",
                (split, exported_sha),
            )
        connection.commit()
        cache_connection.commit()

        by_split = {
            split_name: [entry for entry in dataset_entries if entry.split == split_name]
            for split_name in ("train", "val", "test")
        }

        SPLIT_ROOT.mkdir(parents=True, exist_ok=True)
        for split_name, entries in by_split.items():
            dataset_entries_to_jsonl(entries, SPLIT_ROOT / f"{split_name}.jsonl")

        summary = {
            "manifestMode": manifest_mode,
            "sampleCount": len(samples),
            "groupCount": len(groups),
            "dedupedSampleCount": len(dataset_entries),
            "duplicatesRemoved": len(samples) - len(dataset_entries),
            "blindEvalEligibleGroups": sum(1 for group in groups if group.blind_eval_eligible),
            "trainOnlyGroups": sum(1 for group in groups if not group.blind_eval_eligible),
            "splits": {
                split_name: {
                    "total": len(entries),
                    "milady": sum(1 for entry in entries if entry.label == "milady"),
                    "not_milady": sum(1 for entry in entries if entry.label == "not_milady"),
                    "gold": sum(1 for entry in entries if entry.label_tier == "gold"),
                    "trusted": sum(1 for entry in entries if entry.label_tier == "trusted"),
                    "weak": sum(1 for entry in entries if entry.label_tier == "weak"),
                }
                for split_name, entries in by_split.items()
            },
        }
        write_json_file(
            SPLIT_MANIFEST_PATH,
            {
                "version": 2,
                "generatedAt": now_iso(),
                "mode": manifest_mode,
                "evaluationPolicy": {
                    "blindEvalRequiresGoldOnly": True,
                    "goldLabelSource": GOLD_LABEL_SOURCE,
                    "weakLabelWeight": WEAK_LABEL_WEIGHT,
                },
                "ratios": {
                    "train": args.train_ratio,
                    "val": args.val_ratio,
                    "test": args.test_ratio,
                },
                "groups": manifest_groups,
            },
        )
        (SPLIT_ROOT / "summary.json").write_text(json.dumps(summary["splits"], indent=2, sort_keys=True))
        print("[build-dataset] wrote split manifest and jsonl files", flush=True)
        print(json.dumps(summary, indent=2, sort_keys=True))
    finally:
        cache_connection.close()
        connection.close()


def build_sample_records(connection, cache_connection) -> list[SampleRecord]:
    samples: list[SampleRecord] = []
    processed = 0

    official_paths = [
        path
        for path in sorted(OFFICIAL_IMAGE_ROOT.glob("*.png"))
        if path.is_file() and path.stat().st_size > 0 and path.stem.isdigit()
    ]
    for path in official_paths:
        fingerprint = get_file_fingerprint(cache_connection, path, 128)
        if not fingerprint.readable:
            continue
        samples.append(
            SampleRecord(
                sample_id=f"official:{path.stem}",
                path=path,
                label="milady",
                source="official",
                raw_sha=fingerprint.raw_sha,
                pixel_digest=fingerprint.pixel_digest,
                label_source="official_corpus",
                label_tier="trusted",
                sample_weight=1.0,
                blind_eval_eligible=False,
            )
        )
        processed = maybe_flush_fingerprint_cache(cache_connection, processed + 1)

    for slug, token_id, path in load_derivative_rows():
        fingerprint = get_file_fingerprint(cache_connection, path, 128)
        if not fingerprint.readable:
            continue
        samples.append(
            SampleRecord(
                sample_id=f"derivative:{slug}:{token_id}",
                path=path,
                label="milady",
                source=f"derivative:{slug}",
                raw_sha=fingerprint.raw_sha,
                pixel_digest=fingerprint.pixel_digest,
                label_source="derivative_corpus",
                label_tier="trusted",
                sample_weight=1.0,
                blind_eval_eligible=False,
            )
        )
        processed = maybe_flush_fingerprint_cache(cache_connection, processed + 1)

    exported_rows = connection.execute(
        """
        SELECT sha256, local_path, label
             , COALESCE(label_source, 'unknown') AS label_source
        FROM images
        WHERE label IN ('milady', 'not_milady')
          AND local_path IS NOT NULL
        ORDER BY sha256 ASC
        """
    ).fetchall()
    for row in exported_rows:
        path = resolve_repo_path(str(row["local_path"]))
        if not path.exists():
            continue
        fingerprint = get_file_fingerprint(cache_connection, path, 128)
        if not fingerprint.readable:
            continue
        label_source = str(row["label_source"])
        label_tier = label_tier_for_export_label_source(label_source)
        samples.append(
            SampleRecord(
                sample_id=f"export:{row['sha256']}",
                path=path,
                label=str(row["label"]),
                source="export",
                raw_sha=str(row["sha256"]),
                pixel_digest=fingerprint.pixel_digest,
                label_source=label_source,
                label_tier=label_tier,
                sample_weight=sample_weight_for_label_tier(label_tier),
                blind_eval_eligible=label_tier == "gold",
                exported_sha=str(row["sha256"]),
            )
        )
        processed = maybe_flush_fingerprint_cache(cache_connection, processed + 1)

    cache_connection.commit()
    return samples


def load_derivative_rows() -> list[tuple[str, int, Path]]:
    if not DERIVATIVE_MANIFEST_PATH.exists():
        return []

    manifest = read_json_file(DERIVATIVE_MANIFEST_PATH)
    raw_collections = manifest.get("collections")
    if not isinstance(raw_collections, list):
        return []

    rows: list[tuple[str, int, Path]] = []
    for collection in raw_collections:
        if not isinstance(collection, dict):
            continue
        slug = collection.get("slug")
        samples = collection.get("samples")
        if not isinstance(slug, str) or not isinstance(samples, list) or slug not in ENABLED_DERIVATIVE_SLUGS:
            continue
        for sample in samples:
            if not isinstance(sample, dict):
                continue
            token_id = sample.get("tokenId")
            local_path = sample.get("localPath")
            if not isinstance(token_id, int) or not isinstance(local_path, str):
                continue
            path = resolve_repo_path(local_path)
            if not path.exists():
                continue
            rows.append((slug, token_id, path))
    return rows


def build_group_records(samples: list[SampleRecord]) -> list[GroupRecord]:
    union_find = UnionFind(len(samples))
    raw_sha_to_index: dict[str, int] = {}
    pixel_digest_to_index: dict[str, int] = {}

    for index, sample in enumerate(samples):
        previous = raw_sha_to_index.get(sample.raw_sha)
        if previous is not None:
            union_find.union(index, previous)
        else:
            raw_sha_to_index[sample.raw_sha] = index

        previous = pixel_digest_to_index.get(sample.pixel_digest)
        if previous is not None:
            union_find.union(index, previous)
        else:
            pixel_digest_to_index[sample.pixel_digest] = index

    buckets: dict[int, list[SampleRecord]] = {}
    for index, sample in enumerate(samples):
        buckets.setdefault(union_find.find(index), []).append(sample)

    groups: list[GroupRecord] = []
    for members in buckets.values():
        labels = {member.label for member in members}
        if len(labels) != 1:
            conflicts = ", ".join(sorted(f"{member.sample_id}:{member.label}" for member in members))
            raise SystemExit(f"Conflicting labels within duplicate group: {conflicts}")
        label = next(iter(labels))
        canonical = min(members, key=sample_sort_key)
        group_id = compute_group_id(members)
        blind_eval_eligible = all(member.blind_eval_eligible for member in members)
        groups.append(
            GroupRecord(
                group_id=group_id,
                label=label,
                split="",
                canonical=canonical,
                members=members,
                blind_eval_eligible=blind_eval_eligible,
            )
        )

    return sorted(groups, key=lambda group: group.canonical.sample_id)


def assign_group_splits(groups: list[GroupRecord], args: argparse.Namespace, manifest_path: Path) -> tuple[dict[str, str], str]:
    train_only_assignments = {
        group.group_id: "train"
        for group in groups
        if not group.blind_eval_eligible
    }
    blind_eval_groups = [group for group in groups if group.blind_eval_eligible]

    if args.reset_splits or not manifest_path.exists():
        assignments = train_only_assignments | initial_group_assignments(
            blind_eval_groups,
            args.train_ratio,
            args.val_ratio,
            args.test_ratio,
        )
        return assignments, "fresh"

    manifest = read_json_file(manifest_path)
    raw_groups = manifest.get("groups")
    if not isinstance(raw_groups, list):
        assignments = train_only_assignments | initial_group_assignments(
            blind_eval_groups,
            args.train_ratio,
            args.val_ratio,
            args.test_ratio,
        )
        return assignments, "fresh"

    assignments = {
        str(group["groupId"]): str(group["split"])
        for group in raw_groups
        if isinstance(group, dict) and group.get("split") in {"train", "val", "test"}
    }
    for group_id, split in train_only_assignments.items():
        assignments[group_id] = split

    new_groups = [
        group
        for group in blind_eval_groups
        if group.group_id not in assignments
    ]
    if not new_groups:
        return {group.group_id: assignments[group.group_id] for group in groups}, "reused"

    appended = assign_train_val_only(new_groups, args.train_ratio, args.val_ratio)
    assignments.update(appended)
    return {group.group_id: assignments[group.group_id] for group in groups}, "appended"


def initial_group_assignments(groups: list[GroupRecord], train_ratio: float, val_ratio: float, test_ratio: float) -> dict[str, str]:
    if not groups:
        return {}
    group_ids = [group.group_id for group in groups]
    labels = [1 if group.label == "milady" else 0 for group in groups]
    test_indices, remaining_indices = stratified_group_partition(group_ids, labels, test_ratio, SPLIT_SEED)
    remaining_group_ids = [group_ids[index] for index in remaining_indices]
    remaining_labels = [labels[index] for index in remaining_indices]
    relative_val_ratio = val_ratio / max(1e-9, train_ratio + val_ratio)
    val_indices_within_remaining, train_indices_within_remaining = stratified_group_partition(
        remaining_group_ids,
        remaining_labels,
        relative_val_ratio,
        SPLIT_SEED + 1,
    )

    assignments = {group_ids[index]: "test" for index in test_indices}
    for index in val_indices_within_remaining:
        assignments[remaining_group_ids[index]] = "val"
    for index in train_indices_within_remaining:
        assignments[remaining_group_ids[index]] = "train"
    return assignments


def assign_train_val_only(groups: list[GroupRecord], train_ratio: float, val_ratio: float) -> dict[str, str]:
    if not groups:
        return {}
    group_ids = [group.group_id for group in groups]
    labels = [1 if group.label == "milady" else 0 for group in groups]
    relative_val_ratio = val_ratio / max(1e-9, train_ratio + val_ratio)
    val_indices, train_indices = stratified_group_partition(group_ids, labels, relative_val_ratio, SPLIT_SEED + 2)
    assignments = {group_ids[index]: "val" for index in val_indices}
    for index in train_indices:
        assignments[group_ids[index]] = "train"
    return assignments


def stratified_group_partition(group_ids: list[str], labels: list[int], holdout_ratio: float, random_state: int) -> tuple[list[int], list[int]]:
    total = len(group_ids)
    if total == 0:
        return [], []
    if holdout_ratio <= 0:
        return [], list(range(total))

    target_splits = max(2, round(1 / holdout_ratio))
    class_counts = {
        label: labels.count(label)
        for label in set(labels)
    }
    min_class_count = min(class_counts.values()) if class_counts else 1
    n_splits = min(target_splits, min_class_count, total)
    if n_splits < 2:
        holdout_count = max(1, round(total * holdout_ratio))
        holdout = list(range(holdout_count))
        remaining = list(range(holdout_count, total))
        return holdout, remaining

    splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=random_state)
    split = next(splitter.split([[0]] * total, labels, groups=group_ids))
    remaining_indices, holdout_indices = split
    return list(holdout_indices), list(remaining_indices)


def compute_group_id(members: list[SampleRecord]) -> str:
    keys = sorted({f"sha:{member.raw_sha}" for member in members} | {f"pix:{member.pixel_digest}" for member in members})
    return sha256_bytes("|".join(keys).encode("utf-8"))


def label_tier_for_export_label_source(label_source: str) -> str:
    return "gold" if label_source == GOLD_LABEL_SOURCE else "weak"


def sample_weight_for_label_tier(label_tier: str) -> float:
    return WEAK_LABEL_WEIGHT if label_tier == "weak" else 1.0


def sample_sort_key(sample: SampleRecord) -> tuple[int, str]:
    label_tier_priority = LABEL_TIER_PRIORITY.get(sample.label_tier, len(LABEL_TIER_PRIORITY))
    if sample.source == "export":
        priority = SOURCE_PRIORITY["export"]
    elif sample.source.startswith("derivative:"):
        priority = SOURCE_PRIORITY["derivative"]
    else:
        priority = SOURCE_PRIORITY["official"]
    return label_tier_priority, priority, sample.sample_id


def maybe_flush_fingerprint_cache(connection, processed: int, flush_every: int = 250) -> int:
    if processed % flush_every == 0:
        connection.commit()
        print(f"[build-dataset] fingerprint cache persisted for {processed} samples", flush=True)
    return processed
if __name__ == "__main__":
    main()
