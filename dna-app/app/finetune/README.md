# 파인튜닝 트랙 (Layer 4)

## ⚠️ 발동 조건 — 아래를 모두 충족하기 전에는 진행하지 않는다

1. 고품질 (input, human_final) 쌍이 **해당 단계별 300건 이상** 축적
2. RAG(few-shot)로 해결되지 않는 **반복 실패 패턴이 명확**할 것
   (평가 하네스 리포트에서 동일 검사 항목이 프롬프트 개선 후에도 계속 실패)

둘 중 하나라도 아니면 Layer 2(RAG) 개선이 우선이다.

## 대상 작업 우선순위

1. **기사 → 카드뉴스 텍스트 분할·요약** — 구조가 정형적이라 파인튜닝 효과 큼
2. **녹취 → 기사 초안**
3. 브레인스토밍은 파인튜닝 부적합 — 계속 RAG 유지

## 파이프라인

```bash
# 1) 데이터셋 export (train/val 9:1, 마스킹 필수)
node scripts/export-dataset.mjs --db <sqlite> --tag dataset-v0.1 --stage cardnews --finetune

# 2) LoRA 학습 (로컬 GPU, Qwen/EXAONE 계열 소형 모델)
pip install -r finetune/requirements.txt
python finetune/train_lora.py --train datasets/dataset-v0.1/train.jsonl \
    --val datasets/dataset-v0.1/val.jsonl --base Qwen/Qwen2.5-3B-Instruct

# 3) 골드셋 평가 통과 확인 (통과 못 하면 파이프라인 편입 금지)
npm run eval
```

- 학습 스크립트는 train/val 분리·조기 종료를 포함하고, 학습 후 평가 하네스 실행을 안내한다.
- 파인튜닝 모델은 **2-3 골드셋 평가를 통과해야** 파이프라인에 편입되며,
  Gemini API 결과와 A/B 비교 후 작업별로 선택 사용한다.
