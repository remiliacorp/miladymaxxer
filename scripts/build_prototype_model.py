from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper
from PIL import Image, ImageEnhance

TOTAL_TOKENS = 10_000
SAMPLE_SIZE = 256
FEATURE_SIZE = 32 * 32
IMAGE_DIR = Path("cache/milady-maker")
MODEL_DIR = Path("public/models")
META_DIR = Path("public/generated")
MODEL_PATH = MODEL_DIR / "milady-prototype.onnx"
META_PATH = META_DIR / "milady-prototype.meta.json"


def main() -> None:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    META_DIR.mkdir(parents=True, exist_ok=True)

    token_ids = np.linspace(1, TOTAL_TOKENS, num=SAMPLE_SIZE, dtype=int)
    prototypes = []
    positive_scores = []

    for token_id in token_ids:
        vector = load_vector(token_id)
        prototypes.append(vector)
        positive_scores.append(max(float(np.dot(vector, other)) for other in prototypes))

        for variant in augment_vector(token_id):
            positive_scores.append(max(float(np.dot(variant, prototype)) for prototype in prototypes))

    prototype_matrix = np.stack(prototypes).astype(np.float32)
    threshold = float(np.percentile(np.array(positive_scores, dtype=np.float32), 5))
    model = build_model(prototype_matrix)
    onnx.save(model, MODEL_PATH)

    metadata = {
        "collection": "milady-maker",
        "generatedAt": now_iso(),
        "inputLength": FEATURE_SIZE,
        "threshold": round(threshold, 6),
    }
    META_PATH.write_text(json.dumps(metadata))


def load_vector(token_id: int) -> np.ndarray:
    image = Image.open(IMAGE_DIR / f"{token_id}.png").convert("L")
    return preprocess(image)


def augment_vector(token_id: int) -> list[np.ndarray]:
    source = Image.open(IMAGE_DIR / f"{token_id}.png").convert("L")

    variants: list[np.ndarray] = []
    width, height = source.size
    variants.append(preprocess(source.resize((width - 16, height - 16)).resize((width, height))))
    variants.append(preprocess(ImageEnhance.Brightness(source).enhance(1.12)))
    variants.append(preprocess(ImageEnhance.Contrast(source).enhance(0.9)))
    variants.append(preprocess(source.crop((8, 8, width - 8, height - 8)).resize((width, height))))
    variants.append(preprocess(source.crop((0, 0, width, height - 24)).resize((width, height))))
    variants.append(preprocess(source.crop((12, 0, width - 12, height - 16)).resize((width, height))))
    return variants


def preprocess(image: Image.Image) -> np.ndarray:
    resized = image.resize((32, 32), Image.Resampling.LANCZOS)
    array = np.asarray(resized, dtype=np.float32).reshape(FEATURE_SIZE) / 255.0
    norm = np.linalg.norm(array)
    if norm == 0:
        return array
    return array / norm


def build_model(prototypes: np.ndarray) -> onnx.ModelProto:
    prototypes_transposed = prototypes.T.astype(np.float32)
    input_info = helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, FEATURE_SIZE])
    output_info = helper.make_tensor_value_info("score", TensorProto.FLOAT, [1, 1])

    prototype_tensor = numpy_helper.from_array(prototypes_transposed, name="prototype_matrix")

    l2 = helper.make_node("ReduceL2", ["input"], ["input_norm"], keepdims=1, axes=[1])
    epsilon = numpy_helper.from_array(np.array([[1e-8]], dtype=np.float32), name="epsilon")
    safe_norm = helper.make_node("Add", ["input_norm", "epsilon"], ["safe_input_norm"])
    normalized = helper.make_node("Div", ["input", "safe_input_norm"], ["normalized_input"])
    cosine = helper.make_node("MatMul", ["normalized_input", "prototype_matrix"], ["cosine_scores"])
    best = helper.make_node("ReduceMax", ["cosine_scores"], ["score"], keepdims=1, axes=[1])

    graph = helper.make_graph(
        [l2, safe_norm, normalized, cosine, best],
        "MiladyPrototypeModel",
        [input_info],
        [output_info],
        initializer=[prototype_tensor, epsilon],
    )
    return helper.make_model(graph, opset_imports=[helper.make_opsetid("", 18)])


def now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    main()
