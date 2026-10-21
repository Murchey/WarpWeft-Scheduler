$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$libDir = Join-Path $PSScriptRoot 'lib'
$sourceDir = Join-Path $PSScriptRoot 'src\main\java'
$buildDir = Join-Path $PSScriptRoot 'build'
$fatDir = Join-Path $buildDir 'fat'
$classesDir = Join-Path $buildDir 'classes'
$distDir = Join-Path $root 'resources\solver'
$jarPath = Join-Path $distDir 'warpweft-solver.jar'

$javaHome = $env:JAVA_HOME
$javac = if ($javaHome) { Join-Path $javaHome 'bin\javac.exe' } else { 'javac' }
$jarTool = if ($javaHome) { Join-Path $javaHome 'bin\jar.exe' } else { 'jar' }

if (-not (Get-Command $javac -ErrorAction SilentlyContinue)) {
    throw '找不到 javac。请安装 JDK 21，并设置 JAVA_HOME 或把 bin 目录加入 PATH。'
}

& $javac -version
& $javac --release 21 -encoding UTF-8 -cp (Join-Path $libDir '*') -d $classesDir (Get-ChildItem -Path $sourceDir -Recurse -Filter '*.java' | ForEach-Object { $_.FullName })
if ($LASTEXITCODE -ne 0) { throw 'Java 编译失败' }

if (Test-Path -LiteralPath $fatDir) { Remove-Item -LiteralPath $fatDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $fatDir | Out-Null
Copy-Item -Path (Join-Path $classesDir '*') -Destination $fatDir -Recurse -Force

Push-Location $fatDir
try {
    Get-ChildItem -LiteralPath $libDir -Filter '*.jar' | ForEach-Object {
        & $jarTool xf $_.FullName
        if ($LASTEXITCODE -ne 0) { throw ('解压依赖失败：' + $_.Name) }
    }
} finally {
    Pop-Location
}

$manifest = Join-Path $buildDir 'MANIFEST.MF'
@(
    'Manifest-Version: 1.0'
    'Main-Class: com.warpweft.solver.WarpWeftSolver'
    'Multi-Release: true'
    ''
) | Set-Content -LiteralPath $manifest -Encoding ASCII

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
if (Test-Path -LiteralPath $jarPath) { Remove-Item -LiteralPath $jarPath -Force }
& $jarTool --create --file $jarPath --manifest $manifest -C $fatDir .
if ($LASTEXITCODE -ne 0) { throw 'Java 打包失败' }

Write-Host ('Java solver built: ' + $jarPath) -ForegroundColor Green
