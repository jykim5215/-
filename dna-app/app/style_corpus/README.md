# style_corpus — DNA 문체 코퍼스 (RAG Layer 2)

불변 규칙은 `rules/`에 하드코딩하고, "DNA 특유의 문체"는 이 디렉터리의 우수 사례를
검색해 few-shot 예시로 시스템 프롬프트에 동적 삽입한다. (규칙 ↔ 스타일 분리 원칙)

## 구조

- `gold/` — 골드 스탠다드 예시 (평점 4 이상 human_final + 과거 아카이브 엄선)
- `review/` — 품질 감사에서 보류된 후보. RAG와 파인튜닝에 사용하지 않는다.
  - `review/조정부_카드뉴스_2025.md` — 미해결 교열과 Q&A 재서술을 수정한 뒤 승격
  - `review/추경호_인터뷰기사_2026.md` — 서면 인터뷰 기사 구조 표본 (작업본이라 보류, 발행본 대조 후 승격)
- `reference_pairs/review/` — 원문·산출물 쌍의 구조화 데이터와 자동 감사 보고서
  - `chugyeongho-2026/` — OneDrive 복구본에서 재조립한 쌍. 카드뉴스는 여러 기사 병합 덱 판정(학습 사용 금지)
  - `uploads-2026-07/` — 실물 9쌍+기사 1건 (전부 작업본이라 needs_review — 댓글·추적변경 정리된
    발행본을 받으면 재감사해 ready로 승격). `_template-spec.txt` = 발행팀 공식 템플릿 사양 원문,
    성문화본은 `rules/cardnews_template_spec.md`
  - 새 자료 폴더는 `node scripts/analyze-reference-batch.mjs --src <폴더>`로 일괄 감사한다

## 파일명 규칙 (자료 수집 시)

기사·카드뉴스 파일명은 `기사유형_제목_기자명(복수 가능)` 형식이다.
접두: F(기획) · I(인터뷰) · O(오피니언) · P(포토) · S(스트레이트) — 일괄 감사 스크립트가 이 접두로 카테고리를 분류한다.
- 향후: records 테이블에서 평점 4 이상 레코드를 임베딩해 로컬 벡터 DB에 저장 (마일스톤 5)

## 주의

- 평가 하네스의 골드 평가셋(eval/)과 겹치면 안 된다. 평가셋은 학습/예시에 절대 사용 금지.
- `audit.json`의 `status`가 `ready`이고 `doNotTrain=false`인 쌍만 학습 후보로 사용한다.
