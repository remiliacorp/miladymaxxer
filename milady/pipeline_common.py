from __future__ import annotations

import hashlib
import json
import mimetypes
import os
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE_ROOT = PROJECT_ROOT / "cache"
INGEST_ROOT = CACHE_ROOT / "ingest"
EXPORT_ROOT = CACHE_ROOT / "exports" / "raw"
AVATAR_ROOT = CACHE_ROOT / "avatars" / "files"
DERIVATIVE_ROOT = CACHE_ROOT / "derivatives"
DERIVATIVE_MANIFEST_PATH = DERIVATIVE_ROOT / "manifest.json"
DATASET_ROOT = CACHE_ROOT / "dataset"
SPLIT_ROOT = DATASET_ROOT / "splits"
SPLIT_MANIFEST_PATH = DATASET_ROOT / "split_manifest.json"
INFERENCE_VARIANT_CACHE_VERSION = "cover-center-top-v1"
INFERENCE_VARIANT_ROOT = DATASET_ROOT / "inference_variants" / INFERENCE_VARIANT_CACHE_VERSION
OFFLINE_CACHE_PATH = DATASET_ROOT / "offline_cache.sqlite"
MODEL_RUN_ROOT = CACHE_ROOT / "models" / "mobilenet_v3_small"
MODEL_COMPARE_ROOT = MODEL_RUN_ROOT / "compare"
CATALOG_PATH = DATASET_ROOT / "avatar_catalog.sqlite"
PUBLIC_MODEL_PATH = PROJECT_ROOT / "public" / "models" / "milady-mobilenetv3-small.onnx"
PUBLIC_METADATA_PATH = PROJECT_ROOT / "public" / "generated" / "milady-mobilenetv3-small.meta.json"
OFFICIAL_IMAGE_ROOT = CACHE_ROOT / "milady-maker"
REVIEW_QUEUES = (
    "unlabeled",
    "heuristic_matches",
    "heuristic_reviewed",
    "whitelisted",
    "high_seen_count",
    "notification_group",
    "uncertain_unlabeled",
    "high_score_unlabeled",
    "high_score_false_positive",
)
LABELS = ("milady", "not_milady", "unclear")
LABELED_GRID_FILTERS = ("all", "milady", "not_milady", "unclear")


@dataclass(slots=True)
class ReviewItem:
    sha256: str
    label: str | None
    local_path: str
    byte_size: int | None
    width: int | None
    height: int | None
    handles: list[str]
    display_names: list[str]
    source_surfaces: list[str]
    seen_count: int
    heuristic_match: bool
    heuristic_source: str | None
    heuristic_score: float | None
    heuristic_token_id: int | None
    whitelisted: bool
    max_model_score: float | None
    latest_model_predicted_label: str | None
    latest_model_run_id: str | None
    latest_model_threshold: float | None
    latest_model_distance_to_threshold: float | None
    disagreement_flags: list[str]
    labeled_at: str | None
    example_profile_url: str | None
    example_notification_url: str | None
    example_tweet_url: str | None
    last_seen_at: str | None
    image_url_count: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "sha256": self.sha256,
            "label": self.label,
            "localPath": self.local_path,
            "byteSize": self.byte_size,
            "width": self.width,
            "height": self.height,
            "handles": self.handles,
            "displayNames": self.display_names,
            "sourceSurfaces": self.source_surfaces,
            "seenCount": self.seen_count,
            "heuristicMatch": self.heuristic_match,
            "heuristicSource": self.heuristic_source,
            "heuristicScore": self.heuristic_score,
            "heuristicTokenId": self.heuristic_token_id,
            "whitelisted": self.whitelisted,
            "maxModelScore": self.max_model_score,
            "latestModelPredictedLabel": self.latest_model_predicted_label,
            "latestModelRunId": self.latest_model_run_id,
            "latestModelThreshold": self.latest_model_threshold,
            "latestModelDistanceToThreshold": self.latest_model_distance_to_threshold,
            "disagreementFlags": self.disagreement_flags,
            "labeledAt": self.labeled_at,
            "exampleProfileUrl": self.example_profile_url,
            "exampleNotificationUrl": self.example_notification_url,
            "exampleTweetUrl": self.example_tweet_url,
            "lastSeenAt": self.last_seen_at,
            "imageUrlCount": self.image_url_count,
        }


@dataclass(slots=True)
class FileFingerprint:
    path: str
    file_size: int
    mtime_ns: int
    image_size: int
    raw_sha: str
    pixel_digest: str
    width: int | None
    height: int | None
    readable: bool
    updated_at: str


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def ensure_layout() -> None:
    INGEST_ROOT.mkdir(parents=True, exist_ok=True)
    EXPORT_ROOT.mkdir(parents=True, exist_ok=True)
    AVATAR_ROOT.mkdir(parents=True, exist_ok=True)
    DERIVATIVE_ROOT.mkdir(parents=True, exist_ok=True)
    DATASET_ROOT.mkdir(parents=True, exist_ok=True)
    SPLIT_ROOT.mkdir(parents=True, exist_ok=True)
    INFERENCE_VARIANT_ROOT.mkdir(parents=True, exist_ok=True)
    MODEL_RUN_ROOT.mkdir(parents=True, exist_ok=True)
    MODEL_COMPARE_ROOT.mkdir(parents=True, exist_ok=True)


def connect_db(path: Path = CATALOG_PATH) -> sqlite3.Connection:
    ensure_layout()
    resolved_path = resolve_repo_path(path)
    resolved_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(resolved_path), timeout=30.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA foreign_keys=ON")
    init_db(connection)
    return connection


def connect_offline_cache_db(path: Path = OFFLINE_CACHE_PATH) -> sqlite3.Connection:
    ensure_layout()
    resolved_path = resolve_repo_path(path)
    resolved_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(resolved_path), timeout=30.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    init_offline_cache_db(connection)
    return connection


def init_db(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS exports (
          export_path TEXT PRIMARY KEY,
          export_name TEXT NOT NULL,
          exported_at TEXT,
          ingested_at TEXT NOT NULL,
          version INTEGER,
          avatar_count INTEGER NOT NULL,
          total_sightings INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS avatar_urls (
          normalized_url TEXT PRIMARY KEY,
          original_url TEXT NOT NULL,
          handles_json TEXT NOT NULL,
          display_names_json TEXT NOT NULL,
          source_surfaces_json TEXT NOT NULL,
          seen_count INTEGER NOT NULL,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          example_profile_url TEXT,
          example_notification_url TEXT,
          example_tweet_url TEXT,
          heuristic_match INTEGER,
          heuristic_source TEXT,
          heuristic_score REAL,
          heuristic_token_id INTEGER,
          whitelisted INTEGER NOT NULL DEFAULT 0,
          image_sha256 TEXT,
          download_status TEXT NOT NULL DEFAULT 'pending',
          last_download_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(image_sha256) REFERENCES images(sha256)
        );

        CREATE TABLE IF NOT EXISTS images (
          sha256 TEXT PRIMARY KEY,
          local_path TEXT NOT NULL,
          mime_type TEXT,
          width INTEGER,
          height INTEGER,
          byte_size INTEGER,
          split TEXT,
          label TEXT,
          label_source TEXT,
          labeled_at TEXT,
          review_notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_scores (
          run_id TEXT NOT NULL,
          image_sha256 TEXT NOT NULL,
          score REAL NOT NULL,
          predicted_label TEXT NOT NULL,
          split TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY(run_id, image_sha256),
          FOREIGN KEY(image_sha256) REFERENCES images(sha256)
        );

        CREATE TABLE IF NOT EXISTS label_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_sha256 TEXT NOT NULL,
          previous_label TEXT,
          previous_label_source TEXT,
          previous_labeled_at TEXT,
          previous_review_notes TEXT,
          new_label TEXT NOT NULL,
          new_review_notes TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(image_sha256) REFERENCES images(sha256)
        );

        CREATE INDEX IF NOT EXISTS idx_avatar_urls_image_sha256 ON avatar_urls(image_sha256);
        CREATE INDEX IF NOT EXISTS idx_avatar_urls_download_status ON avatar_urls(download_status);
        CREATE INDEX IF NOT EXISTS idx_images_label ON images(label);
        CREATE INDEX IF NOT EXISTS idx_images_split ON images(split);
        CREATE INDEX IF NOT EXISTS idx_model_scores_image_sha256 ON model_scores(image_sha256);
        CREATE INDEX IF NOT EXISTS idx_label_events_created_at ON label_events(created_at DESC, id DESC);
        """
    )
    ensure_column(connection, "label_events", "batch_id", "TEXT")
    connection.commit()


def init_offline_cache_db(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS file_fingerprints (
          path TEXT PRIMARY KEY,
          file_size INTEGER NOT NULL,
          mtime_ns INTEGER NOT NULL,
          image_size INTEGER NOT NULL,
          raw_sha TEXT NOT NULL,
          pixel_digest TEXT NOT NULL,
          width INTEGER,
          height INTEGER,
          readable INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_file_fingerprints_raw_sha ON file_fingerprints(raw_sha);
        CREATE INDEX IF NOT EXISTS idx_file_fingerprints_pixel_digest ON file_fingerprints(pixel_digest);
        """
    )
    connection.commit()


def ensure_column(connection: sqlite3.Connection, table_name: str, column_name: str, column_definition: str) -> None:
    columns = {
        str(row["name"])
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    }
    if column_name in columns:
        return
    connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}")


def read_json_file(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json_file(path: Path, payload: dict[str, Any] | list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True))


def resolve_repo_path(path: str | Path) -> Path:
    candidate = Path(path)
    if candidate.is_absolute():
        return candidate
    return PROJECT_ROOT / candidate


def parse_json_list(value: str | None) -> list[str]:
    if not value:
        return []
    parsed = json.loads(value)
    if not isinstance(parsed, list):
        return []
    return [entry for entry in parsed if isinstance(entry, str)]


def encode_json_list(values: list[str]) -> str:
    return json.dumps(sorted(set(values)))


def merge_string_lists(left: list[str], right: list[str]) -> list[str]:
    return sorted({entry for entry in [*left, *right] if entry})


def bool_from_db(value: Any) -> bool:
    return bool(value) if value is not None else False


def coalesce_latest(existing: str | None, incoming: str | None) -> str | None:
    return incoming or existing


def min_timestamp(left: str | None, right: str | None) -> str:
    candidates = [value for value in (left, right) if value]
    return min(candidates) if candidates else now_iso()


def max_timestamp(left: str | None, right: str | None) -> str:
    candidates = [value for value in (left, right) if value]
    return max(candidates) if candidates else now_iso()


def discover_export_paths(inputs: list[str]) -> list[Path]:
    if inputs:
        paths = [Path(value) for value in inputs]
    else:
        inbox_paths = sorted(INGEST_ROOT.glob("*.json"))
        legacy_paths = sorted(CACHE_ROOT.glob("milady-shrinkifier-avatars-*.json"))
        paths = inbox_paths if inbox_paths else legacy_paths
    return [path for path in paths if path.exists()]


def normalize_label(value: str | None) -> str | None:
    if value in LABELS:
        return value
    return None


def guess_extension(content_type: str | None, url: str) -> str:
    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if guessed:
            return guessed
    suffix = Path(url).suffix
    return suffix if suffix else ".img"


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def inspect_image_bytes(payload: bytes) -> tuple[int, int, str | None]:
    with Image.open(BytesIO(payload)) as image:
        width, height = image.size
        mime_type = Image.MIME.get(image.format)
    return width, height, mime_type


def get_file_fingerprint(connection: sqlite3.Connection, path: Path, image_size: int) -> FileFingerprint:
    resolved_path = resolve_repo_path(path)
    stat_result = resolved_path.stat()
    cache_row = connection.execute(
        """
        SELECT *
        FROM file_fingerprints
        WHERE path = ?
          AND file_size = ?
          AND mtime_ns = ?
          AND image_size = ?
        """,
        (str(resolved_path), stat_result.st_size, stat_result.st_mtime_ns, image_size),
    ).fetchone()
    if cache_row is not None:
        return row_to_file_fingerprint(cache_row)

    updated_at = now_iso()
    readable = True
    raw_sha = ""
    pixel_digest = ""
    width: int | None = None
    height: int | None = None
    try:
        payload = resolved_path.read_bytes()
        raw_sha = sha256_bytes(payload)
        with Image.open(BytesIO(payload)) as image:
            width, height = image.size
            prepared = image.convert("RGB").resize((image_size, image_size), Image.Resampling.BICUBIC)
            pixel_digest = sha256_bytes(prepared.tobytes())
    except Exception:  # noqa: BLE001
        readable = False

    connection.execute(
        """
        INSERT INTO file_fingerprints (
          path,
          file_size,
          mtime_ns,
          image_size,
          raw_sha,
          pixel_digest,
          width,
          height,
          readable,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          file_size = excluded.file_size,
          mtime_ns = excluded.mtime_ns,
          image_size = excluded.image_size,
          raw_sha = excluded.raw_sha,
          pixel_digest = excluded.pixel_digest,
          width = excluded.width,
          height = excluded.height,
          readable = excluded.readable,
          updated_at = excluded.updated_at
        """,
        (
            str(resolved_path),
            stat_result.st_size,
            stat_result.st_mtime_ns,
            image_size,
            raw_sha,
            pixel_digest,
            width,
            height,
            1 if readable else 0,
            updated_at,
        ),
    )
    return FileFingerprint(
        path=str(resolved_path),
        file_size=stat_result.st_size,
        mtime_ns=stat_result.st_mtime_ns,
        image_size=image_size,
        raw_sha=raw_sha,
        pixel_digest=pixel_digest,
        width=width,
        height=height,
        readable=readable,
        updated_at=updated_at,
    )


def row_to_file_fingerprint(row: sqlite3.Row) -> FileFingerprint:
    return FileFingerprint(
        path=str(row["path"]),
        file_size=int(row["file_size"]),
        mtime_ns=int(row["mtime_ns"]),
        image_size=int(row["image_size"]),
        raw_sha=str(row["raw_sha"]),
        pixel_digest=str(row["pixel_digest"]),
        width=int(row["width"]) if row["width"] is not None else None,
        height=int(row["height"]) if row["height"] is not None else None,
        readable=bool(row["readable"]),
        updated_at=str(row["updated_at"]),
    )


def inference_variant_cache_path(raw_sha: str) -> Path:
    directory = INFERENCE_VARIANT_ROOT / raw_sha[:2]
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{raw_sha}.npz"


def write_npz_atomic(path: Path, **arrays: np.ndarray) -> None:
    temporary_path = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary_path.open("wb") as handle:
        np.savez_compressed(handle, **arrays)
    temporary_path.replace(path)


def load_review_items(connection: sqlite3.Connection) -> list[ReviewItem]:
    image_rows = connection.execute(
        """
        SELECT images.*,
               latest_scores.score AS latest_model_score,
               latest_scores.predicted_label AS latest_model_predicted_label,
               latest_scores.run_id AS latest_model_run_id
        FROM images
        LEFT JOIN (
          SELECT score_records.image_sha256,
                 score_records.score,
                 score_records.predicted_label,
                 score_records.run_id
          FROM model_scores AS score_records
          INNER JOIN (
            SELECT image_sha256, MAX(created_at) AS latest_created_at
            FROM model_scores
            GROUP BY image_sha256
          ) AS latest
            ON latest.image_sha256 = score_records.image_sha256
           AND latest.latest_created_at = score_records.created_at
        ) AS latest_scores
          ON latest_scores.image_sha256 = images.sha256
        WHERE images.local_path IS NOT NULL
        ORDER BY images.updated_at DESC
        """
    ).fetchall()

    avatar_rows = connection.execute(
        """
        SELECT *
        FROM avatar_urls
        WHERE image_sha256 IS NOT NULL
        """
    ).fetchall()

    avatar_by_sha: dict[str, list[sqlite3.Row]] = {}
    for row in avatar_rows:
        avatar_by_sha.setdefault(str(row["image_sha256"]), []).append(row)

    thresholds_by_run = load_model_thresholds(
        {
            str(row["latest_model_run_id"])
            for row in image_rows
            if row["latest_model_run_id"] is not None
        }
    )

    review_items: list[ReviewItem] = []
    for image_row in image_rows:
        sha256 = str(image_row["sha256"])
        related = avatar_by_sha.get(sha256, [])
        handles: list[str] = []
        display_names: list[str] = []
        source_surfaces: list[str] = []
        seen_count = 0
        heuristic_match = False
        heuristic_source: str | None = None
        heuristic_score: float | None = None
        heuristic_token_id: int | None = None
        whitelisted = False
        example_profile_url: str | None = None
        example_notification_url: str | None = None
        example_tweet_url: str | None = None
        last_seen_at: str | None = None

        for row in related:
            handles = merge_string_lists(handles, parse_json_list(row["handles_json"]))
            display_names = merge_string_lists(display_names, parse_json_list(row["display_names_json"]))
            source_surfaces = merge_string_lists(source_surfaces, parse_json_list(row["source_surfaces_json"]))
            seen_count += int(row["seen_count"])
            heuristic_match = heuristic_match or bool_from_db(row["heuristic_match"])
            heuristic_source = heuristic_source or row["heuristic_source"]
            if row["heuristic_score"] is not None:
                score_value = float(row["heuristic_score"])
                heuristic_score = score_value if heuristic_score is None else max(heuristic_score, score_value)
            if row["heuristic_token_id"] is not None:
                heuristic_token_id = int(row["heuristic_token_id"])
            whitelisted = whitelisted or bool_from_db(row["whitelisted"])
            example_profile_url = example_profile_url or row["example_profile_url"]
            example_notification_url = example_notification_url or row["example_notification_url"]
            example_tweet_url = example_tweet_url or row["example_tweet_url"]
            if row["last_seen_at"]:
                last_seen_at = max_timestamp(last_seen_at, str(row["last_seen_at"]))

        human_label = normalize_label(image_row["label"])
        latest_model_predicted_label = (
            str(image_row["latest_model_predicted_label"])
            if image_row["latest_model_predicted_label"] is not None
            else None
        )
        latest_model_run_id = (
            str(image_row["latest_model_run_id"])
            if image_row["latest_model_run_id"] is not None
            else None
        )
        latest_model_threshold = thresholds_by_run.get(latest_model_run_id) if latest_model_run_id else None
        latest_model_score = float(image_row["latest_model_score"]) if image_row["latest_model_score"] is not None else None
        latest_model_distance_to_threshold = (
            abs(latest_model_score - latest_model_threshold)
            if latest_model_score is not None and latest_model_threshold is not None
            else None
        )
        heuristic_predicted_label = "milady" if heuristic_match else "not_milady"
        disagreement_flags: list[str] = []
        if latest_model_predicted_label and latest_model_predicted_label != heuristic_predicted_label:
            disagreement_flags.append("model_vs_heuristic")
        if human_label and human_label != "unclear":
            if human_label != heuristic_predicted_label:
                disagreement_flags.append("human_vs_heuristic")
            if latest_model_predicted_label and human_label != latest_model_predicted_label:
                disagreement_flags.append("human_vs_model")

        review_items.append(
            ReviewItem(
                sha256=sha256,
                label=human_label,
                local_path=str(image_row["local_path"]),
                byte_size=int(image_row["byte_size"]) if image_row["byte_size"] is not None else None,
                width=int(image_row["width"]) if image_row["width"] is not None else None,
                height=int(image_row["height"]) if image_row["height"] is not None else None,
                handles=handles,
                display_names=display_names,
                source_surfaces=source_surfaces,
                seen_count=seen_count,
                heuristic_match=heuristic_match,
                heuristic_source=heuristic_source,
                heuristic_score=heuristic_score,
                heuristic_token_id=heuristic_token_id,
                whitelisted=whitelisted,
                max_model_score=latest_model_score,
                latest_model_predicted_label=latest_model_predicted_label,
                latest_model_run_id=latest_model_run_id,
                latest_model_threshold=latest_model_threshold,
                latest_model_distance_to_threshold=latest_model_distance_to_threshold,
                disagreement_flags=disagreement_flags,
                labeled_at=str(image_row["labeled_at"]) if image_row["labeled_at"] is not None else None,
                example_profile_url=example_profile_url,
                example_notification_url=example_notification_url,
                example_tweet_url=example_tweet_url,
                last_seen_at=last_seen_at,
                image_url_count=len(related),
            )
        )

    return review_items


def queue_items(items: list[ReviewItem], queue_name: str) -> list[ReviewItem]:
    if queue_name not in REVIEW_QUEUES:
        raise ValueError(f"Unsupported review queue: {queue_name}")

    if queue_name == "unlabeled":
        filtered = [item for item in items if item.label is None]
        return sorted(
            filtered,
            key=lambda item: (
                item.heuristic_match,
                item.max_model_score if item.max_model_score is not None else -1.0,
                item.seen_count,
                item.last_seen_at or "",
            ),
            reverse=True,
        )

    if queue_name == "heuristic_matches":
        return sorted(
            (item for item in items if item.heuristic_match and item.label is None),
            key=lambda item: item.seen_count,
            reverse=True,
        )

    if queue_name == "heuristic_reviewed":
        return sorted(
            (item for item in items if item.heuristic_match and item.label is not None),
            key=lambda item: (
                item.seen_count,
                item.labeled_at or "",
            ),
            reverse=True,
        )

    if queue_name == "whitelisted":
        return sorted((item for item in items if item.whitelisted), key=lambda item: item.seen_count, reverse=True)

    if queue_name == "high_seen_count":
        return sorted(items, key=lambda item: item.seen_count, reverse=True)

    if queue_name == "notification_group":
        return sorted(
            (item for item in items if "notification-group" in item.source_surfaces),
            key=lambda item: item.seen_count,
            reverse=True,
        )

    if queue_name == "uncertain_unlabeled":
        return sorted(
            (
                item
                for item in items
                if item.label is None
                and item.max_model_score is not None
                and item.latest_model_threshold is not None
                and item.latest_model_distance_to_threshold is not None
            ),
            key=lambda item: (
                item.latest_model_distance_to_threshold if item.latest_model_distance_to_threshold is not None else float("inf"),
                -(item.seen_count),
            ),
        )

    if queue_name == "high_score_unlabeled":
        return sorted(
            (
                item
                for item in items
                if item.label is None and item.max_model_score is not None
            ),
            key=lambda item: item.max_model_score if item.max_model_score is not None else -1.0,
            reverse=True,
        )

    return sorted(
        (
            item
            for item in items
            if item.label == "not_milady" and item.max_model_score is not None
        ),
        key=lambda item: item.max_model_score if item.max_model_score is not None else -1.0,
        reverse=True,
    )


def load_model_thresholds(run_ids: set[str]) -> dict[str, float]:
    thresholds: dict[str, float] = {}
    for run_id in sorted(run_ids):
        summary_path = MODEL_RUN_ROOT / run_id / "summary.json"
        if not summary_path.exists():
            continue
        try:
            payload = json.loads(summary_path.read_text())
            threshold = payload.get("threshold")
            if threshold is not None:
                thresholds[run_id] = float(threshold)
        except (OSError, ValueError, TypeError):
            continue
    return thresholds


def labeled_grid_items(items: list[ReviewItem], filter_name: str) -> list[ReviewItem]:
    if filter_name not in LABELED_GRID_FILTERS:
        raise ValueError(f"Unsupported labeled grid filter: {filter_name}")

    filtered = [item for item in items if item.label is not None]
    if filter_name != "all":
        filtered = [item for item in filtered if item.label == filter_name]

    return sorted(
        filtered,
        key=lambda item: (
            len(item.disagreement_flags),
            item.max_model_score if item.max_model_score is not None else -1.0,
            item.seen_count,
            item.labeled_at or "",
        ),
        reverse=True,
    )
