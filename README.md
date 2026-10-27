# Reel Talk · Pop Out

내 사진 속 인물과 소품이 휴대폰 프레임 밖으로 나오는 콘텐츠를 만드는 독립 모바일 데모입니다. Meta Global AI Developer Hackathon의 **Build for Your World** 주제에 맞춰 개발합니다.

## 기여 범위

행사 전에 SNS 편집기 프로토타입과 제품 계획이 있었습니다. 이 저장소는 **2026-10-27에 새로 작성한 독립 구현**이며 기존 앱의 소스·이미지·계정 보관함을 포함하지 않습니다. 기존 코드베이스를 런타임 의존성으로 사용하지 않습니다. 일반 npm 라이브러리는 package.json과 잠금 파일에 명시합니다.

새 작업: 사진 정규화, 마스크 기반 피사체 합성, 직접 만든 휴대폰 프레임, 공통 좌표/출력 엔진, SAM/Muse API 어댑터, 영속 호출 예약, 최소 모바일 화면, 기기 초안 보관, 테스트용 벡터 그림과 검증 코드. 실제 API 및 휴대폰 검증 상태는 VALIDATION.md를 따릅니다.

3분 영상 첫 문장 초안(최종 구현 상태에 맞춰 조정):

> A basic mobile editor existed before the event. During this hackathon, we built the standalone SAM-powered pop-out compositor, Muse Image decoration workflow, and mobile demo shown here.

## 실행

Node.js 24, 같은 사설 Wi-Fi의 PC와 iPhone/Android, Expo Go가 필요합니다.

```powershell
cd "C:\Users\User\Desktop\META AI Hackathon\submission"
npm ci
npm start
```

`npm start`를 실행한 터미널에 QR이 표시됩니다. 터미널을 켜둔 채 휴대폰 Expo Go로 QR을 스캔하세요. 이 터미널에서 `r` 키로 연결된 앱을 새로고침할 수 있습니다. 같은 폴더의 다른 터미널에서 `npm run reload`를 실행해도 됩니다. 휴대폰 앱이 연결되기 전에는 새로고침을 보낼 대상이 없습니다.

Metro는 8082, 사진 합성 API는 4180을 사용합니다. QR을 Expo Go로 열면 PC 주소와 별도 연결 코드가 개발 설정에 전달됩니다. 자동 연결이 안 되면 앱 설정에 터미널의 서버 주소와 연결 코드를 입력하세요. 모델 API 키를 휴대폰에 입력하지 않습니다. 개발 서버가 켜진 동안 신뢰하는 로컬 네트워크에서만 사용합니다.

실행 시 `.local/expo-qr.png`에도 QR을 생성합니다. VPN/가상 어댑터를 제외한 LAN 주소를 우선 선택합니다. 네트워크가 여러 개면 `.env`의 `POPOUT_LAN_ADDRESS`로 PC에 실제 할당된 사설 IP를 지정할 수 있습니다.

키 없이 **연습용 그림**으로 합성·위치·비율·저장을 확인할 수 있습니다. 이 그림과 분리 레이어는 직접 만든 벡터 테스트 입력이며 SAM 결과가 아닙니다. 화면에 표시가 남습니다.

## 실제 Meta 모델 연결

먼저 참가자 본인이 크레딧을 신청하고 Billing에 실제 지급·결제 설정·모델 권한이 반영됐는지 확인합니다. 모델 키는 로컬 비밀 입력으로 설정합니다.

```powershell
npm run setup:model
npm start
```

설정 명령은 숨김 입력으로 API 키와 사용자가 정한 **SAM/이미지 전체 호출 상한**을 submission/.env에 저장합니다. 기존 .env가 있으면 덮어쓰지 않습니다. 기본 상한은 0이며 설정 전에는 유료 호출을 차단합니다. 카드 등록이나 약관 동의·크레딧 신청을 대신 실행하지 않습니다.

앱에서 설정 → 연결 확인 → 사진 선택 → 사진에서 대상 탭 또는 짧은 명사 입력 → SAM으로 분리 순서로 진행합니다. SAM 요청에는 정규화된 사진이 Meta로 전송됩니다. 후보가 여럿이면 선택합니다.

Muse Image 장식은 설명으로 생성한 다음 **생성한 장식 배경 분리**를 눌러 SAM으로 투명 에셋을 만듭니다. 전체 과정에 이미지 생성 1회와 SAM 1회가 필요합니다. 앞/뒤 배치와 위치·크기 변경은 추가 모델 호출을 하지 않습니다.

공식 연결:

- SAM: `sam-3.1`, `POST https://api.meta.ai/v1/responses`, [공식 안내](https://dev.meta.ai/docs/sam/overview)
- 마스크: `@meta-sam/parser@0.1.0`, [공식 파서](https://dev.meta.ai/docs/sam/client-libraries)
- 생성: `muse-image-1.0`, Responses API, [공식 안내](https://dev.meta.ai/docs/image-generation)

이 구현은 API 어댑터와 모의 제공자 테스트까지 완료한 상태이며, 키가 없는 상태에서 실제 모델 연결 성공을 주장하지 않습니다.

## 처리와 보관

- 사진은 EXIF 방향을 적용하고 최대 1600px로 정규화합니다. 박스·마스크는 이 이미지 좌표를 사용합니다.
- 원본과 피사체에 동일한 확대·이동을 적용합니다. 편집값을 바꾼 후 **변경 적용**을 누르면 PNG 미리보기를 만듭니다. 저장 파일은 같은 PNG입니다.
- 4:5는 1080×1350, 9:16은 1080×1920, 1:1은 1080×1080입니다. 프레임은 직접 렌더링합니다.
- PC의 `.local/projects`에 원본·피사체·장식·설정을 보관합니다. 기기에는 최근 미리보기·원본과 프로젝트 목록을 교대 저장합니다. 이전 작업의 재편집은 해당 PC의 파일과 연결이 필요합니다. 마지막으로 보관한 결과는 기기에 남습니다.
- 전체 호출 상한은 `.local/model-jobs.json`의 영속 예약을 기준으로 적용합니다. 처리 중이거나 결과 미확인인 호출도 상한에 포함하며 자동 재시도하지 않습니다. 같은 작업 ID는 성공 결과를 재사용합니다.
- 호출 횟수 제한은 **계정 잔액·달러 예산·제공자 전체 사용량 측정이 아닙니다.** 제공자 Billing을 별도로 확인합니다. 기록 파일을 지워 제한을 초기화하지 않습니다.
- 서버는 한 사용자·한 프로세스 개발용입니다. 공개 배포·다중 사용자 인증·클라우드 백업을 구현한 상태가 아닙니다.

## 현재 제약

실제 SAM/Muse 응답, 머리카락 품질, iPhone/Android 기기 실행·권한·앨범/공유를 아직 검증하지 않았습니다. 마스크 브러시 보정, 터치 드래그/핀치, 장식 재표시, MP4, 영상 추적, SNS 직접 게시와 오픈 모델 통합은 현재 범위에 포함되지 않습니다. 그림에서 조절 가능한 UI는 실제 사진 검증을 대체하지 않습니다.

후속 기기 확인: 사용자가 연습용 합성과 조절 동작을 확인했습니다. 앨범 저장의 SDK 58 구형 API 오류는 `Asset.create`로 수정했으며 기기 재확인이 필요합니다. 저장 성공 시 휴대폰 사진 보관함의 자산 ID를 받은 후 안내하며, 실패는 저장 버튼 아래와 알림으로 표시합니다. iOS는 사진 앱의 최근 추가 사진, Android는 갤러리/Google 포토의 기기 사진에서 확인합니다.

## 검증

```powershell
npm test
npm run typecheck
npm run fixture
```

fixture 명령은 원본 벡터 그림과 세 비율 합성 결과를 `.local/fixtures`에 생성합니다. 자동 테스트의 Meta 응답은 명시적인 모의 데이터이며 실제 과금을 발생시키지 않습니다.

## 제출 준비

- 행사 중 개발한 코드만 포함한 이 폴더를 공개 저장소로 준비합니다. `.env`, `.local`, `node_modules`, 개인 사진·키를 포함하지 않습니다.
- 저장소를 내려받은 뒤 `npm ci`로 실행할 수 있는지 확인합니다.
- 실제 사진과 모델 결과로 3분 영상을 만들고 첫 문장에서 사전 작업을 밝힙니다.
- [제출 페이지](https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit)에 공개 코드·영상·참가자 전원을 기재합니다. 마감은 MYT 2026-11-05 10:00, 내부 목표는 11-04 18:00입니다.
- 운영진의 standalone extract 지침에 맞춰 기존 코드베이스를 제외했습니다. 개별 참가 자격과 최종 제출 폼 요건은 별도 확인해야 합니다.
