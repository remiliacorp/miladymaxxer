from __future__ import annotations

import argparse
import json
import os
import random
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter

import numpy as np
import torch
import wandb
from torch import nn
from torch.utils.data import DataLoader

from .mobilenet_common import (
    AvatarDataset,
    CLASS_NAMES,
    MODEL_IMAGE_SIZE,
    MODEL_MEAN,
    MODEL_STD,
    POSITIVE_INDEX,
    choose_threshold,
    compute_metrics,
    create_model,
    load_dataset_entries,
    probabilities_from_model,
)
from .pipeline_common import MODEL_RUN_ROOT, SPLIT_ROOT, connect_offline_cache_db

HEADLINE_EVAL_POLICY = "manual_export_gold_only"

DEFAULT_WANDB_PROJECT = "milady-shrinkifier"
DEFAULT_WANDB_ENTITY = "banteg-"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a MobileNetV3-Small binary Milady classifier.")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--num-workers", type=int, default=default_num_workers())
    parser.add_argument("--prefetch-factor", type=int, default=4)
    parser.add_argument("--head-warmup-epochs", type=int, default=2)
    parser.add_argument("--scheduler", choices=("onecycle", "cosine", "off"), default="cosine")
    parser.add_argument("--head-learning-rate", type=float, help="Optional LR for classifier-head warmup. Defaults to learning rate.")
    parser.add_argument("--label-smoothing", type=float, default=0.02)
    parser.add_argument("--augment", choices=("on", "off"), default="on")
    parser.add_argument("--log-every", type=int, default=25, help="Print a batch progress update every N training steps.")
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--precision-floor", type=float, default=0.995)
    parser.add_argument("--run-id", default=datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ"))
    parser.add_argument("--cpu", action="store_true", help="Force CPU training even when MPS/CUDA is available.")
    parser.add_argument(
        "--wandb-project",
        default=os.environ.get("WANDB_PROJECT", DEFAULT_WANDB_PROJECT),
        help="Weights & Biases project name.",
    )
    parser.add_argument(
        "--wandb-entity",
        default=os.environ.get("WANDB_ENTITY", DEFAULT_WANDB_ENTITY),
        help="Weights & Biases entity/user/team.",
    )
    parser.add_argument("--no-wandb", action="store_true", help="Disable Weights & Biases logging for this run.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    train_entries = load_dataset_entries(SPLIT_ROOT / "train.jsonl")
    val_entries = load_dataset_entries(SPLIT_ROOT / "val.jsonl")
    test_entries = load_dataset_entries(SPLIT_ROOT / "test.jsonl")
    if not train_entries or not val_entries:
        raise SystemExit("Missing train/val split files. Run build_training_dataset.py first.")

    seed_everything(args.seed)
    device = choose_device(args.cpu)
    head_warmup_epochs = max(0, min(args.head_warmup_epochs, args.epochs))
    finetune_epochs = max(0, args.epochs - head_warmup_epochs)
    head_learning_rate = args.head_learning_rate if args.head_learning_rate is not None else args.learning_rate
    train_loader = DataLoader(
        AvatarDataset(train_entries, training=True, augment=args.augment == "on"),
        batch_size=args.batch_size,
        shuffle=True,
        generator=build_loader_generator(args.seed),
        **dataloader_kwargs(args, device),
    )
    model = create_model(pretrained=True).to(device)
    set_trainable_parameters(model, head_only=head_warmup_epochs > 0)
    optimizer = create_optimizer(model, args.weight_decay, head_learning_rate if head_warmup_epochs > 0 else args.learning_rate)
    scheduler = create_scheduler(args.scheduler, optimizer, args.learning_rate, len(train_loader), finetune_epochs) if head_warmup_epochs == 0 else None
    criterion = build_loss(train_entries, args.label_smoothing).to(device)
    run_dir = MODEL_RUN_ROOT / args.run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    cache_connection = connect_offline_cache_db()
    try:
        print_run_header(
            args,
            device,
            train_entries,
            val_entries,
            test_entries,
            run_dir,
            head_warmup_epochs,
            head_learning_rate,
            finetune_epochs,
        )
        wandb_run = init_wandb(
            args,
            device,
            train_entries,
            val_entries,
            test_entries,
            run_dir,
            head_warmup_epochs,
            head_learning_rate,
        )

        best_state: dict[str, torch.Tensor] | None = None
        best_threshold = 0.995
        best_selection_key = (-1.0, -1.0, -1.0, -1.0)
        best_epoch = -1
        best_val_metrics: dict[str, float] | None = None
        history: list[dict[str, float | int]] = []
        stale_epochs = 0
        training_started_at = perf_counter()
        completed_epoch_durations: list[float] = []
        global_step = 0
        phase = "warmup" if head_warmup_epochs > 0 else "finetune"

        for epoch in range(1, args.epochs + 1):
            if epoch == head_warmup_epochs + 1 and head_warmup_epochs > 0:
                phase = "finetune"
                set_trainable_parameters(model, head_only=False)
                optimizer = create_optimizer(model, args.weight_decay, args.learning_rate)
                scheduler = create_scheduler(args.scheduler, optimizer, args.learning_rate, len(train_loader), finetune_epochs)
                stale_epochs = 0
                print(
                    f"[phase] switching to full fine-tune lr={args.learning_rate:g} scheduler={args.scheduler}",
                    flush=True,
                )
            print(f"[epoch {epoch}/{args.epochs}] start", flush=True)
            epoch_started_at = perf_counter()
            train_loss, global_step = run_epoch(
                model,
                train_loader,
                criterion,
                optimizer,
                device,
                epoch,
                args.epochs,
                args.log_every,
                wandb_run,
                global_step,
                scheduler,
                phase,
            )
            val_probabilities, val_labels = evaluate(model, val_entries, device, args.batch_size, cache_connection)
            threshold, threshold_metrics = choose_threshold(val_probabilities, val_labels, args.precision_floor)
            epoch_duration_seconds = perf_counter() - epoch_started_at
            completed_epoch_durations.append(epoch_duration_seconds)
            history.append(
                {
                    "epoch": epoch,
                    "phase": phase,
                    "learningRate": current_learning_rate(optimizer),
                    "trainLoss": train_loss,
                    "valPrecision": threshold_metrics["precision"],
                    "valRecall": threshold_metrics["recall"],
                    "valF1": threshold_metrics["f1"],
                    "threshold": threshold,
                }
            )
            if wandb_run is not None:
                wandb.log(
                    {
                        "epoch": epoch,
                        "trainer/global_step": global_step,
                        "train/loss": train_loss,
                        "train/lr": current_learning_rate(optimizer),
                        "trainer/phase": 0 if phase == "warmup" else 1,
                        "val/precision": threshold_metrics["precision"],
                        "val/recall": threshold_metrics["recall"],
                        "val/f1": threshold_metrics["f1"],
                        "val/threshold": threshold,
                        "timing/epoch_seconds": epoch_duration_seconds,
                        "timing/total_elapsed_seconds": perf_counter() - training_started_at,
                    }
                )
            selection_key = (
                threshold_metrics["recall"],
                threshold_metrics["precision"],
                threshold_metrics["f1"],
                threshold,
            )
            improved = selection_key > best_selection_key
            stale_after_epoch = 0 if improved else (stale_epochs + 1 if phase == "finetune" else stale_epochs)
            overall_eta_seconds = estimate_overall_eta(args.epochs, epoch, completed_epoch_durations)
            print_epoch_summary(
                epoch,
                args.epochs,
                train_loss,
                phase,
                current_learning_rate(optimizer),
                threshold,
                threshold_metrics,
                improved,
                stale_after_epoch,
                args.patience,
                epoch_duration_seconds,
                perf_counter() - training_started_at,
                overall_eta_seconds,
            )

            if improved:
                best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}
                best_threshold = threshold
                best_selection_key = selection_key
                best_epoch = epoch
                best_val_metrics = threshold_metrics
                if phase == "finetune":
                    stale_epochs = 0
                print(
                    f"[epoch {epoch}/{args.epochs}] new best checkpoint "
                    f"(recall={threshold_metrics['recall']:.4f}, threshold={best_threshold:.4f})",
                    flush=True,
                )
            else:
                if phase == "finetune":
                    stale_epochs += 1
                if phase == "finetune" and stale_epochs >= args.patience:
                    print(
                        f"[epoch {epoch}/{args.epochs}] early stopping after {stale_epochs} stale epoch(s)",
                        flush=True,
                    )
                    break

        if best_state is None or best_val_metrics is None:
            raise SystemExit("Training did not produce a checkpoint.")

        checkpoint_path = run_dir / "best.pt"
        torch.save(best_state, checkpoint_path)
        print(f"[checkpoint] saved best weights to {checkpoint_path}", flush=True)

        model.load_state_dict(best_state)
        val_probabilities, val_labels = evaluate(model, val_entries, device, args.batch_size, cache_connection)
        best_threshold, best_val_metrics = choose_threshold(val_probabilities, val_labels, args.precision_floor)
        print("[test] evaluating best checkpoint on test split", flush=True)
        test_probabilities, test_labels = evaluate(model, test_entries, device, args.batch_size, cache_connection)
        test_metrics = compute_metrics(test_probabilities, test_labels, best_threshold)

        summary = {
            "runId": args.run_id,
            "architecture": "mobilenet_v3_small",
            "classNames": CLASS_NAMES,
            "positiveIndex": POSITIVE_INDEX,
            "imageSize": MODEL_IMAGE_SIZE,
            "mean": MODEL_MEAN,
            "std": MODEL_STD,
            "precisionFloor": args.precision_floor,
            "seed": args.seed,
            "numWorkers": max(0, args.num_workers),
            "prefetchFactor": max(1, args.prefetch_factor) if args.num_workers > 0 else None,
            "pinMemory": False,
            "headWarmupEpochs": head_warmup_epochs,
            "scheduler": args.scheduler,
            "headLearningRate": head_learning_rate,
            "learningRate": args.learning_rate,
            "labelSmoothing": args.label_smoothing,
            "augment": args.augment == "on",
            "evaluationPolicy": {
                "headline": HEADLINE_EVAL_POLICY,
                "trainIncludesTrustedSynthetic": True,
                "trainIncludesWeakLabels": True,
            },
            "bestEpoch": best_epoch,
            "threshold": best_threshold,
            "history": history,
            "valMetrics": best_val_metrics,
            "testMetrics": test_metrics,
            "valDiagnosticsBySource": diagnostic_metrics_by(entries=val_entries, probabilities=val_probabilities, threshold=best_threshold),
            "testDiagnosticsBySource": diagnostic_metrics_by(entries=test_entries, probabilities=test_probabilities, threshold=best_threshold),
            "checkpointPath": str(checkpoint_path),
        }
        (run_dir / "summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True))
        if wandb_run is not None:
            wandb.log(
                {
                    "epoch": best_epoch,
                    "best/epoch": best_epoch,
                    "best/threshold": best_threshold,
                    "best/val_precision": best_val_metrics["precision"],
                    "best/val_recall": best_val_metrics["recall"],
                    "best/val_f1": best_val_metrics["f1"],
                    "headline/val_precision": best_val_metrics["precision"],
                    "headline/val_recall": best_val_metrics["recall"],
                    "headline/val_f1": best_val_metrics["f1"],
                    "test/precision": test_metrics["precision"],
                    "test/recall": test_metrics["recall"],
                    "test/f1": test_metrics["f1"],
                    "test/accuracy": test_metrics["accuracy"],
                    "headline/test_precision": test_metrics["precision"],
                    "headline/test_recall": test_metrics["recall"],
                    "headline/test_f1": test_metrics["f1"],
                }
            )
            summary_artifact = wandb.Artifact(f"{args.run_id}-summary", type="training-summary")
            summary_artifact.add_file(local_path=str(run_dir / "summary.json"), name="summary.json")
            summary_artifact.add_file(local_path=str(checkpoint_path), name="best.pt")
            wandb_run.log_artifact(summary_artifact)
            wandb_run.summary["checkpoint_path"] = str(checkpoint_path)
            wandb_run.summary["run_dir"] = str(run_dir)
            wandb_run.summary["best_epoch"] = best_epoch
            wandb_run.summary["best_threshold"] = best_threshold
            wandb_run.finish()
        print(
            "[done] "
            f"best_epoch={best_epoch} "
            f"threshold={best_threshold:.4f} "
            f"blind_val_precision={best_val_metrics['precision']:.4f} "
            f"blind_val_recall={best_val_metrics['recall']:.4f} "
            f"blind_test_precision={test_metrics['precision']:.4f} "
            f"blind_test_recall={test_metrics['recall']:.4f}",
            flush=True,
        )
        print(json.dumps(summary, indent=2, sort_keys=True))
    finally:
        cache_connection.close()


def init_wandb(
    args: argparse.Namespace,
    device: torch.device,
    train_entries: list,
    val_entries: list,
    test_entries: list,
    run_dir: Path,
    head_warmup_epochs: int,
    head_learning_rate: float,
) -> wandb.sdk.wandb_run.Run | None:
    if args.no_wandb:
        print("[wandb] disabled via --no-wandb", flush=True)
        return None
    if not args.wandb_project:
        print("[wandb] disabled because WANDB_PROJECT/--wandb-project is not set", flush=True)
        return None
    config = {
        "run_id": args.run_id,
        "architecture": "mobilenet_v3_small",
        "device": device.type,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "seed": args.seed,
        "num_workers": args.num_workers,
        "prefetch_factor": args.prefetch_factor if args.num_workers > 0 else None,
        "pin_memory": False,
        "head_warmup_epochs": head_warmup_epochs,
        "scheduler": args.scheduler,
        "head_learning_rate": head_learning_rate,
        "log_every": args.log_every,
        "learning_rate": args.learning_rate,
        "label_smoothing": args.label_smoothing,
        "augment": args.augment == "on",
        "weight_decay": args.weight_decay,
        "patience": args.patience,
        "precision_floor": args.precision_floor,
        "train_size": len(train_entries),
        "val_size": len(val_entries),
        "test_size": len(test_entries),
        "train_milady": sum(1 for entry in train_entries if entry.label == "milady"),
        "train_not_milady": sum(1 for entry in train_entries if entry.label != "milady"),
        "image_size": MODEL_IMAGE_SIZE,
        "mean": MODEL_MEAN,
        "std": MODEL_STD,
        "artifacts_dir": str(run_dir),
    }
    run = wandb.init(
        project=args.wandb_project,
        entity=args.wandb_entity,
        name=args.run_id,
        job_type="train-classifier",
        config=config,
    )
    run.define_metric("epoch")
    run.define_metric("trainer/global_step")
    run.define_metric("train/*", step_metric="trainer/global_step")
    run.define_metric("val/*", step_metric="epoch")
    run.define_metric("test/*", step_metric="epoch")
    run.define_metric("best/*", step_metric="epoch")
    run.define_metric("timing/batch_elapsed_seconds", step_metric="trainer/global_step")
    run.define_metric("timing/epoch_eta_seconds", step_metric="trainer/global_step")
    run.define_metric("timing/epoch_seconds", step_metric="epoch")
    run.define_metric("timing/total_elapsed_seconds", step_metric="epoch")
    print(
        f"[wandb] enabled project={args.wandb_project}"
        + (f" entity={args.wandb_entity}" if args.wandb_entity else "")
        + (f" url={run.url}" if getattr(run, "url", None) else ""),
        flush=True,
    )
    return run


def choose_device(force_cpu: bool) -> torch.device:
    if force_cpu:
        return torch.device("cpu")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def default_num_workers() -> int:
    cpu_count = os.cpu_count() or 1
    return max(1, min(4, cpu_count // 2))


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.use_deterministic_algorithms(True, warn_only=True)


def build_loader_generator(seed: int) -> torch.Generator:
    generator = torch.Generator()
    generator.manual_seed(seed)
    return generator


def worker_init_fn(worker_id: int) -> None:
    worker_seed = torch.initial_seed() % (2**32)
    random.seed(worker_seed)
    np.random.seed(worker_seed)
    torch.manual_seed(worker_seed)


def dataloader_kwargs(args: argparse.Namespace, device: torch.device) -> dict[str, object]:
    num_workers = max(0, args.num_workers)
    kwargs: dict[str, object] = {
        "num_workers": num_workers,
        "pin_memory": False,
    }
    if num_workers > 0:
        kwargs["persistent_workers"] = True
        kwargs["worker_init_fn"] = worker_init_fn
        kwargs["prefetch_factor"] = max(1, args.prefetch_factor)
    return kwargs


def build_loss(train_entries: list, label_smoothing: float) -> nn.Module:
    positive_weight_total = sum(entry.sample_weight for entry in train_entries if entry.label == "milady")
    negative_weight_total = sum(entry.sample_weight for entry in train_entries if entry.label != "milady")
    positive_weight = negative_weight_total / max(1e-8, positive_weight_total)
    return nn.CrossEntropyLoss(
        weight=torch.tensor([1.0, positive_weight], dtype=torch.float32),
        reduction="none",
        label_smoothing=label_smoothing,
    )


def create_optimizer(model: nn.Module, weight_decay: float, learning_rate: float) -> torch.optim.Optimizer:
    parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
    return torch.optim.AdamW(parameters, lr=learning_rate, weight_decay=weight_decay)


def create_scheduler(
    scheduler_name: str,
    optimizer: torch.optim.Optimizer,
    learning_rate: float,
    steps_per_epoch: int,
    epochs: int,
):
    total_steps = max(1, steps_per_epoch * epochs)
    if scheduler_name == "off" or epochs <= 0:
        return None
    if scheduler_name == "onecycle":
        return torch.optim.lr_scheduler.OneCycleLR(
            optimizer,
            max_lr=learning_rate,
            total_steps=total_steps,
            pct_start=0.1,
            anneal_strategy="cos",
            div_factor=25.0,
            final_div_factor=1e4,
        )
    return torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=total_steps)


def set_trainable_parameters(model: nn.Module, *, head_only: bool) -> None:
    for name, parameter in model.named_parameters():
        parameter.requires_grad = name.startswith("classifier") if head_only else True


def current_learning_rate(optimizer: torch.optim.Optimizer) -> float:
    return float(optimizer.param_groups[0]["lr"])


def set_backbone_batchnorm_mode(model: nn.Module, *, frozen: bool) -> None:
    for name, module in model.named_modules():
        if name.startswith("classifier"):
            continue
        if isinstance(module, nn.modules.batchnorm._BatchNorm):
            module.eval() if frozen else module.train()


def run_epoch(
    model: nn.Module,
    loader: DataLoader,
    criterion: nn.Module,
    optimizer: torch.optim.Optimizer,
    device: torch.device,
    epoch: int,
    total_epochs: int,
    log_every: int,
    wandb_run: wandb.sdk.wandb_run.Run | None,
    global_step_base: int,
    scheduler,
    phase: str,
) -> tuple[float, int]:
    model.train()
    set_backbone_batchnorm_mode(model, frozen=phase == "warmup")
    total_loss = 0.0
    total_items = 0
    total_batches = max(1, len(loader))
    epoch_started_at = perf_counter()
    for batch_index, (inputs, labels, sample_weights) in enumerate(loader, start=1):
        inputs = inputs.to(device)
        labels = labels.to(device)
        sample_weights = sample_weights.to(device=device, dtype=torch.float32)
        optimizer.zero_grad(set_to_none=True)
        logits = model(inputs)
        loss_values = criterion(logits, labels)
        loss = (loss_values * sample_weights).sum() / sample_weights.sum().clamp_min(1e-8)
        loss.backward()
        optimizer.step()
        if scheduler is not None:
            scheduler.step()
        total_loss += float(loss.item()) * inputs.size(0)
        total_items += inputs.size(0)
        if should_log_batch(batch_index, total_batches, log_every):
            average_loss = total_loss / max(1, total_items)
            elapsed_seconds = perf_counter() - epoch_started_at
            average_batch_seconds = elapsed_seconds / max(1, batch_index)
            epoch_eta_seconds = average_batch_seconds * max(0, total_batches - batch_index)
            global_step = global_step_base + batch_index
            print(
                f"[epoch {epoch}/{total_epochs}] batch {batch_index}/{total_batches} "
                f"loss={loss.item():.4f} avg_loss={average_loss:.4f} "
                f"elapsed={format_duration(elapsed_seconds)} eta={format_duration(epoch_eta_seconds)}",
                flush=True,
            )
            if wandb_run is not None:
                wandb.log(
                    {
                        "epoch": epoch,
                        "trainer/global_step": global_step,
                        "trainer/phase": 0 if phase == "warmup" else 1,
                        "train/batch_loss": float(loss.item()),
                        "train/batch_avg_loss": average_loss,
                        "train/lr": current_learning_rate(optimizer),
                        "timing/batch_elapsed_seconds": elapsed_seconds,
                        "timing/epoch_eta_seconds": epoch_eta_seconds,
                    }
                )
    return total_loss / max(1, total_items), global_step_base + total_batches


def evaluate(
    model: nn.Module,
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


def print_run_header(
    args: argparse.Namespace,
    device: torch.device,
    train_entries: list,
    val_entries: list,
    test_entries: list,
    run_dir: Path,
    head_warmup_epochs: int,
    head_learning_rate: float,
    finetune_epochs: int,
) -> None:
    positives = sum(1 for entry in train_entries if entry.label == "milady")
    negatives = len(train_entries) - positives
    print(
        f"[setup] run_id={args.run_id} device={device.type} "
        f"epochs={args.epochs} batch_size={args.batch_size} lr={args.learning_rate:g} "
        f"weight_decay={args.weight_decay:g} patience={args.patience} precision_floor={args.precision_floor:.4f} "
        f"seed={args.seed} "
        f"warmup_epochs={head_warmup_epochs} head_lr={head_learning_rate:g} "
        f"scheduler={args.scheduler} label_smoothing={args.label_smoothing:g} augment={args.augment}",
        flush=True,
    )
    print(
        f"[setup] splits train={len(train_entries)} val={len(val_entries)} test={len(test_entries)} "
        f"train_milady={positives} train_not_milady={negatives} "
        f"num_workers={max(0, args.num_workers)} prefetch_factor={(max(1, args.prefetch_factor) if args.num_workers > 0 else 'n/a')} "
        f"pin_memory=off finetune_epochs={finetune_epochs}",
        flush=True,
    )
    print(f"[setup] artifacts={run_dir}", flush=True)


def print_epoch_summary(
    epoch: int,
    total_epochs: int,
    train_loss: float,
    phase: str,
    learning_rate: float,
    threshold: float,
    threshold_metrics: dict[str, float],
    improved: bool,
    stale_epochs: int,
    patience: int,
    epoch_duration_seconds: float,
    total_elapsed_seconds: float,
    overall_eta_seconds: float,
) -> None:
    status = "best" if improved else f"stale={stale_epochs}/{patience}"
    print(
        f"[epoch {epoch}/{total_epochs}] "
        f"phase={phase} "
        f"lr={learning_rate:.6g} "
        f"train_loss={train_loss:.4f} "
        f"val_precision={threshold_metrics['precision']:.4f} "
        f"val_recall={threshold_metrics['recall']:.4f} "
        f"val_f1={threshold_metrics['f1']:.4f} "
        f"threshold={threshold:.4f} "
        f"epoch_time={format_duration(epoch_duration_seconds)} "
        f"total_elapsed={format_duration(total_elapsed_seconds)} "
        f"overall_eta={format_duration(overall_eta_seconds)} "
        f"{status}",
        flush=True,
    )


def should_log_batch(batch_index: int, total_batches: int, log_every: int) -> bool:
    if batch_index == 1 or batch_index == total_batches:
        return True
    if log_every <= 0:
        return False
    return batch_index % log_every == 0


def estimate_overall_eta(total_epochs: int, completed_epochs: int, epoch_durations: list[float]) -> float:
    if completed_epochs >= total_epochs or not epoch_durations:
        return 0.0
    average_epoch_seconds = sum(epoch_durations) / len(epoch_durations)
    return average_epoch_seconds * max(0, total_epochs - completed_epochs)


def format_duration(seconds: float) -> str:
    total_seconds = max(0, int(round(seconds)))
    hours, remainder = divmod(total_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours > 0:
        return f"{hours}h{minutes:02d}m{secs:02d}s"
    if minutes > 0:
        return f"{minutes}m{secs:02d}s"
    return f"{secs}s"


def diagnostic_metrics_by(entries: list, probabilities: list[float], threshold: float) -> dict[str, dict[str, dict[str, float] | int | str]]:
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
