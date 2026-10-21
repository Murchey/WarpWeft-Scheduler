$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$out = Join-Path $root 'dist\solver'
if (-not (Get-Command pyinstaller -ErrorAction SilentlyContinue)) {
  py -m pip install "pyinstaller>=6.10,<7" "-r" (Join-Path $root 'services\solver\requirements.txt')
}
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
Push-Location $root
try {
  pyinstaller --noconfirm --clean --distpath $out --workpath (Join-Path $root 'build\solver') (Join-Path $root 'services\solver\solver.spec')
} finally { Pop-Location }
