$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $configPath) {
  Write-Host '이미 submission/.env가 있습니다. 기존 설정을 보존합니다. 파일에서 키와 호출 한도를 수정하세요.'
  exit 0
}
Write-Host 'Meta Model API 키를 PC에만 저장합니다. 키를 채팅이나 휴대폰에 입력하지 마세요.'
Write-Host '먼저 Billing에서 지급 크레딧, 카드 설정, 사용량을 확인하세요.'
$creditCheck = Read-Host 'Billing에 대회 크레딧 $150이 실제 표시되고, API 키를 발급할 팀과 같은 팀임을 확인했으면 YES 입력'
if ($creditCheck -cne 'YES') {
  Write-Host '크레딧 지급 확인 전에는 유료 모델 호출 설정을 진행하지 않습니다. 신청서 제출과 실제 지급은 다릅니다.'
  exit 1
}
$creditTeamId = Read-Host '크레딧 신청에 쓴 Model API Team ID (team_id= 뒤 숫자만)'
if ($creditTeamId -notmatch '^\d+$') { throw 'Team ID는 숫자만 입력하세요. URL, Project ID, API 키, 해커톤 팀 이름은 입력하지 않습니다.' }
$secureKey = Read-Host 'MODEL_API_KEY (입력 숨김)' -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try { $modelKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer) }
if ([string]::IsNullOrWhiteSpace($modelKey) -or $modelKey -match '[\s"'']') { throw '공백 없는 유효한 API 키를 입력하세요.' }
$samLimitText = Read-Host '전체 SAM 호출 상한 (예: 3, 장식 배경 분리도 SAM 1회 사용)'
$imageLimitText = Read-Host '전체 이미지 생성 호출 상한 (예: 1)'
$samLimit = 0
$imageLimit = 0
if (-not [int]::TryParse($samLimitText, [ref]$samLimit) -or $samLimit -lt 0 -or -not [int]::TryParse($imageLimitText, [ref]$imageLimit) -or $imageLimit -lt 0) { throw '0 이상의 정수 호출 상한을 입력하세요.' }
$pairingToken = [guid]::NewGuid().ToString()
$configuration = "MODEL_API_KEY=$modelKey`nHACKATHON_CREDITS_CONFIRMED=true`nHACKATHON_CREDIT_TEAM_ID=$creditTeamId`nPOPOUT_TOKEN=$pairingToken`nSAM_REQUEST_CAP=$samLimit`nIMAGE_REQUEST_CAP=$imageLimit`nPOPOUT_PORT=4180`n"
[IO.File]::WriteAllText($configPath, $configuration, [Text.UTF8Encoding]::new($false))
$modelKey = $null
$configuration = $null
Write-Host '저장했습니다. npm start를 다시 실행하면 적용됩니다.'
Write-Host '호출 기록은 재시작해도 유지됩니다. 상한은 제공자 잔액이나 실제 과금 차단 기능이 아닙니다.'
Write-Host '다음: npm run check:model (모델 목록 조회, 이미지 생성/분할 없음). 실행 중 서버가 있으면 Ctrl+C 후 npm start로 다시 시작하세요.'
