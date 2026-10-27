$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $configPath) {
  Write-Host '이미 submission/.env가 있습니다. 기존 설정을 보존합니다. 파일에서 키와 호출 한도를 수정하세요.'
  exit 0
}
Write-Host 'Meta Model API 키를 PC에만 저장합니다. 키를 채팅이나 휴대폰에 입력하지 마세요.'
Write-Host '먼저 Billing에서 지급 크레딧, 카드 설정, 사용량을 확인하세요.'
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
$configuration = "MODEL_API_KEY=$modelKey`nPOPOUT_TOKEN=$pairingToken`nSAM_REQUEST_CAP=$samLimit`nIMAGE_REQUEST_CAP=$imageLimit`nPOPOUT_PORT=4180`n"
[IO.File]::WriteAllText($configPath, $configuration, [Text.UTF8Encoding]::new($false))
$modelKey = $null
$configuration = $null
Write-Host '저장했습니다. npm start를 다시 실행하면 적용됩니다.'
Write-Host '호출 기록은 재시작해도 유지됩니다. 상한은 제공자 잔액이나 실제 과금 차단 기능이 아닙니다.'
