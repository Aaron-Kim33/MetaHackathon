# AI 결과 재사용과 누끼 복구 / Reusable AI results and cutout repair

사용자가 2026-10-28에 확정한 제품 요구사항입니다. 소재 보관함·영속 요청 캐시·복구 비교 UI를 구현했습니다. 아래 검증 상태와 제한을 함께 참고하세요.

The asset library, persistent request cache and repair comparison UI are implemented. Validation and limitations are listed below.

## 재사용이 기본 / Reuse by default

- 원본 → 누끼 → 복구 이미지 → 재분리 결과를 별도 버전으로 보존합니다. 각 버전은 원본과 부모 결과, 모델, 프롬프트, 설정, 요청 ID, 비용 기록을 연결합니다.
- 기존 누끼·복구본·생성 소재를 다시 배치하거나 다른 편집에서 가져올 때 AI를 재호출하지 않습니다. 위치·크기·회전·테마 변경도 추가 추론 없이 처리합니다.
- 같은 입력 이미지/마스크·모델·프롬프트·설정 조합은 저장된 결과를 먼저 찾습니다. 결과를 다시 생성하는 동작은 명시적으로 구분합니다.
- 복구 생성은 성공했지만 재분리가 실패했다면 생성 이미지를 보존합니다. 다음 시도에서 생성까지 처음부터 반복하지 않습니다.
- 재사용 기록은 신규 호출과 구분합니다. 신규 요청 수와 추가 모델 비용은 0이며, 사용한 원래 결과의 ID를 남깁니다.
- 소재 보관함은 최근 프로젝트 목록과 다릅니다. 편집 프로젝트는 기존대로 마지막 작업 하나를 복원합니다.

Preserve immutable versions and provenance; reuse assets across edits; prefer exact-request cache hits; retain successful stages after downstream failures; log reuse separately from inference. Asset reuse must not reintroduce a recent-project gallery.

## 누끼 후 복구 / Repair after cutout

1. 누끼 결과를 먼저 보여주고 `그대로 사용 / Use as is`, `잘린 부분 복구 / Repair cutout`를 제공합니다.
2. 복구할 부분과 함께 보존할 부속 요소를 지정할 수 있게 합니다. 기존 원본과 누끼를 재사용해 의도를 전달합니다.
3. 실행 전 별도의 비용 확인 화면은 표시하지 않습니다. 비용과 사용량은 뒤에서 기록합니다.
4. 결과를 비교한 뒤 `원본 유지 / Keep original`, `복구본 적용 / Apply repair`를 선택합니다.
5. 적용해도 요소 ID와 위치·크기·각도·레이어 순서는 유지합니다. 원본과 이전 버전은 다시 선택하거나 실행 취소할 수 있게 보존합니다.

Show the cutout first, offer optional repair, omit a pre-execution cost confirmation screen, compare before applying, and preserve placement and prior versions.

개발 중 실제 AI 테스트는 기존대로 승인된 범위·횟수 안에서만 실행합니다. 비용 확인 UI를 생략하는 것이 추가 실험이나 호출 한도 상향을 허용하는 것은 아닙니다.

Development experiments still require the approved scope and count. Omitting the product cost dialog does not authorize extra tests or higher call limits.

## 구현과 검증 / Implementation and validation

- 사진 → 소재 보관함에서 누끼·생성 이미지·복구 버전을 다시 가져옵니다. 누끼 완료 안내와 피사체 도구에서 복구 화면을 열 수 있습니다.
- 복구 의도와 함께 남길 물체는 문장으로 지정합니다. 영역을 칠하는 추가 입력 UI는 아직 포함하지 않습니다.
- 동일 요청은 이미지 내용·모델·프롬프트·설정을 기준으로 디스크 캐시를 확인합니다. 재사용은 호출 한도를 소모하지 않으며 실험 로그에 별도 기록됩니다.
- 생성 후 재분리 실패 시 생성 이미지와 결과 캐시가 보존됩니다. '실패 단계 다시 시도'를 명시적으로 눌러야 실패한 단계의 새 호출을 시도합니다.
- 적용은 같은 요소의 변환 값과 ID를 유지합니다. 새 결과를 기존 캔버스 크기에 맞춰 담고, 적용 전 대상이 바뀌었으면 덮어쓰지 않습니다. 이전 버전도 다시 선택할 수 있습니다.
- 흰 배경으로 생성한 이미지에서는 SAM이 제외한 부속 요소를 색 대비와 마스크로 보정합니다. 유리의 물리적으로 정확한 투명도를 재현하는 기능은 아닙니다. 적용 전에 비교 결과를 확인합니다.
- 모의 제공자로 실패 단계 재개·재시작 후 캐시 재사용·원본 복귀·요소 위치 보존·오래된 결과 덮어쓰기 방지를 검증했습니다. 이번 구현 검증에서 Meta 실호출은 하지 않았습니다. 실제 기기 조작은 사용자 확인이 필요합니다.

Open Photo → Asset library, or Repair cutout after segmentation. Describe missing parts and attached objects in text. Requests reuse persistent content-based caches without consuming model call caps. Explicit failed-stage retry preserves successful earlier stages. Apply preserves element identity and transform values and rejects stale target versions. White-background detail retention is a heuristic, not physically accurate glass matting. Validation uses a mocked provider; device interaction still needs user confirmation.
