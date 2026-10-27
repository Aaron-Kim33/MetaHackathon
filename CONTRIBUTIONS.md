# 행사 중 기여 기록

2026-10-27에 이 폴더의 독립 구현을 시작했습니다. 행사 전 제품 구상과 기존 모바일 편집기가 있었으며, 이전 코드베이스는 이 저장소에 포함하지 않습니다.

| 새 파일/영역 | 행사 중 개발한 기능 |
|---|---|
| server/composition.mjs | 원본 정규화, 공통 좌표, 프레임·피사체·그림자·장식 합성 |
| server/meta.mjs | 공식 SAM/Muse 요청, 공식 파서 연결, 실제 결과만 허용 |
| server/store.mjs | 프로젝트 보관, 호출 예약·중복 방지·미확인 결과 유지 |
| server/index.mjs | 인증된 개발 API, 사진 업로드·대상 선택·렌더링·모델 작업 |
| App.tsx, src | 신규 최소 편집 화면, 기기 초안, 출력·공유 연결 |
| src/GestureCanvas.tsx, src/layout.ts | 모바일 드래그/핀치·원본 비교·서버와 공유하는 좌표 계산 |
| src/MaskEditor.tsx, server/mask.mjs | 모바일 누끼 브러시, 원본 픽셀 복원·리셋·버전 충돌 거부 |
| src/ToolRail.tsx, src/editor-layout.ts, App.tsx | 고정 캔버스·옆 도구·접이식 하단 도구 패널, 화면 내 누끼 보정·키보드/작은 화면 배치 |
| server/fixture.mjs | 좌표 검사에 쓰는 직접 제작 벡터 인물과 배경 |
| scripts | 독립 실행, 숨김 모델 키 설정, 합성 검증 그림 생성 |
| tests | 정렬·마스크·모델 응답·비용 통제·로컬 API 검증 |

모델의 실제 호출 성공, 기기 테스트와 사용자 실험은 VALIDATION.md에 증거가 추가된 뒤에만 완료로 설명합니다. 개발 중 코딩 에이전트를 사용했다는 사실은 제품의 Agentic 기능을 구현했다는 뜻이 아닙니다.
