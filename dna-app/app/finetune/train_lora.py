#!/usr/bin/env python3
"""LoRA 파인튜닝 스크립트 (스캐폴드) — 소형 오픈 모델 + instruction JSONL.

발동 조건(finetune/README.md)을 충족하기 전에는 실행하지 않는다:
  - 단계별 고품질 (input, human_final) 쌍 300건 이상
  - RAG로 해결 안 되는 반복 실패 패턴 명확

사용법:
  python finetune/train_lora.py --train datasets/dataset-v0.1/train.jsonl \
      --val datasets/dataset-v0.1/val.jsonl --base Qwen/Qwen2.5-3B-Instruct

학습 후: `npm run eval`로 골드셋 평가를 통과해야 파이프라인 편입 가능.
"""
import argparse
import json
import sys
from pathlib import Path


def load_jsonl(p):
    return [json.loads(l) for l in Path(p).read_text(encoding="utf-8").splitlines() if l.strip()]


def to_chat(example):
    return {
        "messages": [
            {"role": "system", "content": example["instruction"]},
            {"role": "user", "content": example["input"]},
            {"role": "assistant", "content": example["output"]},
        ]
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", required=True)
    ap.add_argument("--val", required=True)
    ap.add_argument("--base", default="Qwen/Qwen2.5-3B-Instruct",
                    help="소형 오픈 모델 (Qwen/EXAONE 계열 권장)")
    ap.add_argument("--out", default="finetune/out")
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--min-pairs", type=int, default=300)
    args = ap.parse_args()

    train = load_jsonl(args.train)
    val = load_jsonl(args.val)

    # 발동 조건 강제: 300쌍 미만이면 중단
    if len(train) + len(val) < args.min_pairs:
        sys.exit(
            f"✗ 데이터 {len(train) + len(val)}쌍 < 최소 {args.min_pairs}쌍 — "
            "파인튜닝 발동 조건 미충족. RAG(Layer 2) 개선을 우선하세요."
        )

    try:
        import torch  # noqa
        from datasets import Dataset
        from peft import LoraConfig
        from transformers import AutoModelForCausalLM, AutoTokenizer, EarlyStoppingCallback
        from trl import SFTConfig, SFTTrainer
    except ImportError:
        sys.exit("✗ 의존성 없음: pip install -r finetune/requirements.txt")

    tokenizer = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype="auto", device_map="auto")

    train_ds = Dataset.from_list([to_chat(e) for e in train])
    val_ds = Dataset.from_list([to_chat(e) for e in val])

    peft_config = LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05, task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    )
    config = SFTConfig(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=8,
        eval_strategy="steps",
        eval_steps=50,
        save_steps=50,
        load_best_model_at_end=True,          # 조기 종료 연동
        metric_for_best_model="eval_loss",
        save_total_limit=3,
        logging_steps=10,
    )
    trainer = SFTTrainer(
        model=model,
        args=config,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        peft_config=peft_config,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=3)],
    )
    trainer.train()
    trainer.save_model(args.out)
    print(f"✓ 학습 완료 → {args.out}")
    print("다음 단계: npm run eval 로 골드셋 평가를 통과해야 파이프라인 편입 가능 (A/B 비교 필수).")


if __name__ == "__main__":
    main()
