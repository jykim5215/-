# 골드 평가셋 (Layer 3)

대표 케이스의 (입력, 모범 출력) 고정 세트. **이 세트는 학습·few-shot 예시에 절대 사용하지 않는다**
(`style_corpus/`와 격리). 프롬프트나 파이프라인을 바꿀 때마다 전체를 돌려 점수를 비교한다.

- `cases.jsonl` — 한 줄에 케이스 하나: `{ id, type: draft|email|cardnews, input, output, note }`
- 실행: `npm run eval` (회귀 비교), `npm run eval -- --update-baseline` (기준선 갱신)
- LLM-as-judge 포함: `npm run eval -- --judge` (`GEMINI_API_KEY` 환경변수 필요)
- **회귀 정책: 통과율이 기준선(eval/report-baseline.json)보다 떨어지면 exit 1 → 배포 차단.**

현재는 시드 4케이스다. 실제 데이터가 쌓이는 대로 대표 케이스 20~30개로 확장할 것
(부트스트랩 임포트 후 과거 기사에서 선정 권장).
