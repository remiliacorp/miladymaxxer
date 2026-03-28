from __future__ import annotations

import json
import math
import random
import sqlite3
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Literal

import numpy as np
import torch
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from torch import nn
from torch.utils.data import Dataset
from torchvision import transforms
from torchvision.models import MobileNet_V3_Small_Weights, mobilenet_v3_small

from .pipeline_common import (
    connect_offline_cache_db,
    get_file_fingerprint,
    inference_variant_cache_path,
    write_npz_atomic,
)

MODEL_IMAGE_SIZE = 128
MODEL_MEAN = [0.485, 0.456, 0.406]
MODEL_STD = [0.229, 0.224, 0.225]
POSITIVE_LABEL = "milady"
NEGATIVE_LABEL = "not_milady"
CLASS_NAMES = [NEGATIVE_LABEL, POSITIVE_LABEL]
POSITIVE_INDEX = 1
SPLIT_SEED = 1337
INFERENCE_CROP_VARIANTS: tuple[Literal["center", "top"], ...] = ("center", "top")


@dataclass(slots=True)
class DatasetEntry:
    sample_id: str
    path: Path
    label: str
    source: str
    split: str
    label_source: str
    label_tier: str
    sample_weight: float


class AvatarDataset(Dataset[tuple[torch.Tensor, int, float]]):
    def __init__(self, entries: list[DatasetEntry], training: bool, augment: bool = True) -> None:
        self.entries = entries
        self.training = training
        self.augment = augment
        self.to_tensor = transforms.Compose(
            [
                transforms.Resize((MODEL_IMAGE_SIZE, MODEL_IMAGE_SIZE)),
                transforms.ToTensor(),
                transforms.Normalize(mean=MODEL_MEAN, std=MODEL_STD),
            ]
        )

    def __len__(self) -> int:
        return len(self.entries)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, int, float]:
        entry = self.entries[index]
        with Image.open(entry.path) as image:
            prepared = image.convert("RGB")
            if self.training and self.augment:
                prepared = apply_training_augment(prepared)
            tensor = self.to_tensor(prepared)
        label_index = POSITIVE_INDEX if entry.label == POSITIVE_LABEL else 0
        return tensor, label_index, float(entry.sample_weight)


def create_model(pretrained: bool = True) -> nn.Module:
    weights = MobileNet_V3_Small_Weights.IMAGENET1K_V1 if pretrained else None
    model = mobilenet_v3_small(weights=weights)
    in_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(in_features, len(CLASS_NAMES))
    return model


class ExportWrapper(nn.Module):
    def __init__(self, model: nn.Module) -> None:
        super().__init__()
        self.model = model
        self.softmax = nn.Softmax(dim=1)

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        logits = self.model(inputs)
        return self.softmax(logits)


def apply_training_augment(image: Image.Image) -> Image.Image:
    square = ImageOps.fit(image, (160, 160), method=Image.Resampling.BICUBIC, centering=(0.5, 0.4))
    crop_size = random.randint(116, 154)
    max_offset = 160 - crop_size
    offset_x = random.randint(0, max_offset)
    max_top_offset = max(1, math.floor(max_offset * 0.55))
    offset_y = random.randint(0, max_top_offset)
    cropped = square.crop((offset_x, offset_y, offset_x + crop_size, offset_y + crop_size))
    augmented = cropped.resize((MODEL_IMAGE_SIZE, MODEL_IMAGE_SIZE), Image.Resampling.BICUBIC)

    if random.random() < 0.35:
        enhanced = ImageEnhance.Brightness(augmented).enhance(random.uniform(0.9, 1.12))
        augmented = ImageEnhance.Contrast(enhanced).enhance(random.uniform(0.9, 1.12))
    if random.random() < 0.25:
        augmented = ImageEnhance.Color(augmented).enhance(random.uniform(0.92, 1.08))
    if random.random() < 0.2:
        augmented = augmented.filter(ImageFilter.GaussianBlur(radius=random.uniform(0.2, 0.8)))
    if random.random() < 0.25:
        buffer = BytesIO()
        augmented.save(buffer, format="JPEG", quality=random.randint(52, 86))
        buffer.seek(0)
        augmented = Image.open(buffer).convert("RGB")

    return augmented


def load_dataset_entries(path: Path) -> list[DatasetEntry]:
    entries: list[DatasetEntry] = []
    if not path.exists():
        return entries
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        entries.append(
            DatasetEntry(
                sample_id=str(payload["id"]),
                path=Path(str(payload["path"])),
                label=str(payload["label"]),
                source=str(payload["source"]),
                split=str(payload["split"]),
                label_source=str(payload.get("labelSource") or "unknown"),
                label_tier=str(payload.get("labelTier") or "unknown"),
                sample_weight=float(payload.get("sampleWeight", 1.0)),
            )
        )
    return entries


def compute_metrics(probabilities: list[float], labels: list[int], threshold: float) -> dict[str, float]:
    true_positive = 0
    false_positive = 0
    true_negative = 0
    false_negative = 0

    for probability, label in zip(probabilities, labels, strict=True):
        predicted = 1 if probability >= threshold else 0
        if predicted == 1 and label == 1:
            true_positive += 1
        elif predicted == 1 and label == 0:
            false_positive += 1
        elif predicted == 0 and label == 0:
            true_negative += 1
        else:
            false_negative += 1

    precision = true_positive / (true_positive + false_positive) if (true_positive + false_positive) else 0.0
    recall = true_positive / (true_positive + false_negative) if (true_positive + false_negative) else 0.0
    accuracy = (true_positive + true_negative) / max(1, len(labels))
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0

    return {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "truePositive": float(true_positive),
        "falsePositive": float(false_positive),
        "trueNegative": float(true_negative),
        "falseNegative": float(false_negative),
    }


def choose_threshold(probabilities: list[float], labels: list[int], precision_floor: float) -> tuple[float, dict[str, float]]:
    if not probabilities:
        return 0.995, compute_metrics(probabilities, labels, 0.995)

    candidates = sorted({0.0, 1.0, *probabilities})
    scored_candidates = [
        (float(threshold), compute_metrics(probabilities, labels, float(threshold)))
        for threshold in candidates
    ]
    passing_candidates = [
        (threshold, metrics)
        for threshold, metrics in scored_candidates
        if metrics["precision"] >= precision_floor
    ]

    if passing_candidates:
        best_threshold, best_metrics = max(
            passing_candidates,
            key=lambda item: (
                item[1]["recall"],
                item[1]["precision"],
                item[1]["f1"],
                item[0],
            ),
        )
        return best_threshold, best_metrics

    best_threshold, best_metrics = max(
        scored_candidates,
        key=lambda item: (
            item[1]["precision"],
            item[1]["recall"],
            item[1]["f1"],
            item[0],
        ),
    )
    return best_threshold, best_metrics


def score_logits_to_probabilities(logits: torch.Tensor) -> torch.Tensor:
    return torch.softmax(logits, dim=1)[:, POSITIVE_INDEX]


def dataset_entries_to_jsonl(entries: list[DatasetEntry], path: Path) -> None:
    lines = [
        json.dumps(
            {
                "id": entry.sample_id,
                "path": str(entry.path),
                "label": entry.label,
                "source": entry.source,
                "split": entry.split,
                "labelSource": entry.label_source,
                "labelTier": entry.label_tier,
                "sampleWeight": entry.sample_weight,
            }
        )
        for entry in entries
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + ("\n" if lines else ""))


def load_image_for_inference(path: Path) -> torch.Tensor:
    connection = connect_offline_cache_db()
    try:
        return load_image_for_inference_with_cache(path, connection)
    finally:
        connection.close()


def load_image_for_inference_with_cache(path: Path, connection: sqlite3.Connection) -> torch.Tensor:
    fingerprint = get_file_fingerprint(connection, path, MODEL_IMAGE_SIZE)
    if not fingerprint.readable:
        raise ValueError(f"Unreadable image: {path}")
    center, top = load_or_create_inference_variant_arrays(path, fingerprint.raw_sha)
    return variants_tensor_from_arrays(center, top)


def load_image_variants_for_inference(image: Image.Image) -> torch.Tensor:
    arrays = [prepare_inference_variant_array(image, variant) for variant in INFERENCE_CROP_VARIANTS]
    return variants_tensor_from_arrays(arrays[0], arrays[1])


def prepare_inference_variant_array(image: Image.Image, variant: Literal["center", "top"]) -> np.ndarray:
    centering = (0.5, 0.0) if variant == "top" else (0.5, 0.5)
    prepared = ImageOps.fit(
        image.convert("RGB"),
        (MODEL_IMAGE_SIZE, MODEL_IMAGE_SIZE),
        method=Image.Resampling.BICUBIC,
        centering=centering,
    )
    return np.asarray(prepared, dtype=np.uint8)


def variants_tensor_from_arrays(center: np.ndarray, top: np.ndarray) -> torch.Tensor:
    variants = [center, top]
    tensors = []
    for array in variants:
        tensor = torch.from_numpy(np.array(array, copy=True)).permute(2, 0, 1).to(dtype=torch.float32) / 255.0
        tensor = transforms.Normalize(mean=MODEL_MEAN, std=MODEL_STD)(tensor)
        tensors.append(tensor)
    return torch.stack(tensors, dim=0)


def load_or_create_inference_variant_arrays(path: Path, raw_sha: str) -> tuple[np.ndarray, np.ndarray]:
    cache_path = inference_variant_cache_path(raw_sha)
    if cache_path.exists():
        try:
            with np.load(cache_path) as payload:
                return payload["center"], payload["top"]
        except Exception:  # noqa: BLE001
            cache_path.unlink(missing_ok=True)

    with Image.open(path) as image:
        prepared = image.convert("RGB")
        center = prepare_inference_variant_array(prepared, "center")
        top = prepare_inference_variant_array(prepared, "top")
    write_npz_atomic(cache_path, center=center, top=top)
    return center, top


def probabilities_from_model(
    model: nn.Module,
    paths: list[Path],
    device: torch.device,
    batch_size: int = 64,
    connection: sqlite3.Connection | None = None,
) -> np.ndarray:
    model.eval()
    batches: list[np.ndarray] = []
    owned_connection = connection is None
    cache_connection = connection or connect_offline_cache_db()
    with torch.no_grad():
        try:
            for start in range(0, len(paths), batch_size):
                batch_paths = paths[start : start + batch_size]
                tensors = torch.cat(
                    [load_image_for_inference_with_cache(path, cache_connection) for path in batch_paths],
                    dim=0,
                ).to(device)
                logits = model(tensors)
                probabilities = score_logits_to_probabilities(logits).view(len(batch_paths), len(INFERENCE_CROP_VARIANTS))
                max_probabilities = torch.max(probabilities, dim=1).values
                batches.append(max_probabilities.detach().cpu().numpy())
        finally:
            if owned_connection:
                cache_connection.close()
    return np.concatenate(batches) if batches else np.array([], dtype=np.float32)
