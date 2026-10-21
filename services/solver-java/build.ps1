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

$dependencies = @(
    @{
        Name = 'jackson-annotations-2.17.2.jar'
        CachePath = 'com\fasterxml\jackson\core\jackson-annotations\2.17.2\jackson-annotations-2.17.2.jar'
        Url = 'https://repo.maven.apache.org/maven2/com/fasterxml/jackson/core/jackson-annotations/2.17.2/jackson-annotations-2.17.2.jar'
    },
    @{
        Name = 'jackson-core-2.17.2.jar'
        CachePath = 'com\fasterxml\jackson\core\jackson-core\2.17.2\jackson-core-2.17.2.jar'
        Url = 'https://repo.maven.apache.org/maven2/com/fasterxml/jackson/core/jackson-core/2.17.2/jackson-core-2.17.2.jar'
    },
    @{
        Name = 'jackson-databind-2.17.2.jar'
        CachePath = 'com\fasterxml\jackson\core\jackson-databind\2.17.2\jackson-databind-2.17.2.jar'
        Url = 'https://repo.maven.apache.org/maven2/com/fasterxml/jackson/core/jackson-databind/2.17.2/jackson-databind-2.17.2.jar'
    }
)

New-Item -ItemType Directory -Force -Path $libDir | Out-Null
foreach ($dependency in $dependencies) {
    $target = Join-Path $libDir $dependency.Name
    if (Test-Path -LiteralPath $target) { continue }
    $cache = Join-Path $env:USERPROFILE ('.m2\repository\' + $dependency.CachePath)
    if (Test-Path -LiteralPath $cache) {
        Copy-Item -LiteralPath $cache -Destination $target -Force
        Write-Host ('使用本地 Maven 缓存：' + $dependency.Name) -ForegroundColor DarkGray
        continue
    }
    Write-Host ('下载依赖：' + $dependency.Name) -ForegroundColor DarkGray
    try {
        Invoke-WebRequest -Uri $dependency.Url -OutFile $target -UseBasicParsing
    } catch {
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force }
        throw ('无法获取 Java 依赖 ' + $dependency.Name + '：' + $_.Exception.Message + '。可以手动下载后放入 services/solver-java/lib。')
    }
    if (-not (Test-Path -LiteralPath $target)) {
        throw ('Java 依赖下载失败：' + $dependency.Name)
    }
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
