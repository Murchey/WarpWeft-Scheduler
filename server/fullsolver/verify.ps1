$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $root)
$jar = Join-Path $root 'dist\warpweft-fullsolver.jar'
$solverJar = Join-Path $repoRoot 'resources\solver\warpweft-solver.jar'
$seed = Join-Path $repoRoot 'database\seeds\demo.json'
$fixtures = Join-Path $root 'tests'

if (-not (Test-Path -LiteralPath $solverJar)) {
    throw ('缺少 MVP 求解器：' + $solverJar + '。请先在 WarpWeft-Scheduler 运行 npm run build:solver。')
}
if (-not (Test-Path -LiteralPath $seed)) {
    throw ('缺少演示数据：' + $seed)
}

& (Join-Path $root 'build.ps1')
if (-not (Test-Path -LiteralPath $jar)) { throw '构建后仍找不到 jar' }

New-Item -ItemType Directory -Force -Path $fixtures | Out-Null
$base = Get-Content -LiteralPath $seed -Raw | ConvertFrom-Json
$teacher = $base.teachers[0].id

function New-Fixture($path, $rules) {
    $data = Get-Content -LiteralPath $seed -Raw | ConvertFrom-Json
    $data | Add-Member -Force -NotePropertyName protocolVersion -NotePropertyValue '1.0'
    $data | Add-Member -Force -NotePropertyName dataSnapshotVersion -NotePropertyValue 'fullsolver-fixture'
    $data | Add-Member -Force -NotePropertyName hardConstraints -NotePropertyValue @()
    $data | Add-Member -Force -NotePropertyName softConstraints -NotePropertyValue @()
    $data | Add-Member -Force -NotePropertyName unavailableSlots -NotePropertyValue @()
    $data | Add-Member -Force -NotePropertyName lockedEntries -NotePropertyValue @()
    $data | Add-Member -Force -NotePropertyName timeLimitSeconds -NotePropertyValue 10
    $data | Add-Member -Force -NotePropertyName randomSeed -NotePropertyValue 1
    $data | Add-Member -Force -NotePropertyName rules -NotePropertyValue $rules
    [System.IO.File]::WriteAllText($path, ($data | ConvertTo-Json -Depth 20), [System.Text.UTF8Encoding]::new($false))
}

New-Fixture (Join-Path $fixtures 'feasible.json') @()

$rule = [ordered]@{
    id = 'rule-hard-teacher'
    kind = 'TEACHER_MAX_DAILY'
    scope = @{ type = 'teacher'; teacherId = $teacher }
    time = @{ type = 'all' }
    importance = 'must'
    params = @{ maxPerDay = 1 }
    enabled = $true
    source = 'manual'
    createdAt = '2026-10-21T00:00:00.000Z'
}
New-Fixture (Join-Path $fixtures 'conflict.json') @($rule)

$javaHome = $env:JAVA_HOME
$java = if ($javaHome) { Join-Path $javaHome 'bin\java.exe' } else { 'java' }

function Invoke-FullSolver($inputPath, $mode) {
    $json = & $java '-jar' $jar '--input' $inputPath '--solver' $solverJar '--mode' $mode 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw ('完整求解器退出码 ' + $LASTEXITCODE + '：' + $json) }
    return $json | ConvertFrom-Json
}

$failures = New-Object System.Collections.Generic.List[string]

$feasible = Invoke-FullSolver (Join-Path $fixtures 'feasible.json') 'mus'
if ($feasible.status -ne 'no-conflict') { $failures.Add('feasible.json 期望 no-conflict，实际 ' + $feasible.status) }

$conflict = Invoke-FullSolver (Join-Path $fixtures 'conflict.json') 'mus'
if ($conflict.status -ne 'conflict') {
    $failures.Add('conflict.json 期望 conflict，实际 ' + $conflict.status)
} else {
    $ids = @($conflict.minimalConflictSets[0].ruleIds)
    if ($ids -notcontains 'rule-hard-teacher') { $failures.Add('MUS 未包含 rule-hard-teacher：' + ($ids -join ',')) }
    if ([int]$conflict.minimalConflictSets[0].size -ne 1) { $failures.Add('MUS 规模应为 1，实际 ' + $conflict.minimalConflictSets[0].size) }
    if ($conflict.oracleCalls -lt 2) { $failures.Add('可行性判定调用次数异常：' + $conflict.oracleCalls) }
}

$minimum = Invoke-FullSolver (Join-Path $fixtures 'conflict.json') 'minimum'
if ($minimum.status -ne 'conflict') {
    $failures.Add('minimum 模式期望 conflict，实际 ' + $minimum.status)
} elseif ([int]$minimum.minimalConflictSets[0].size -ne 1) {
    $failures.Add('minimum 模式最小势应为 1，实际 ' + $minimum.minimalConflictSets[0].size)
}

if ($failures.Count -eq 0) {
    Write-Host '全流程验证通过：3 个场景（可行 / MUS / 最小势）' -ForegroundColor Green
    exit 0
}
$failures | ForEach-Object { Write-Host ('失败：' + $_) -ForegroundColor Red }
exit 1

