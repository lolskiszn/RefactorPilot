$ErrorActionPreference = "Stop"

$IsWindowsPlatform = $env:OS -eq "Windows_NT"
$Root = $PSScriptRoot
$Upstream = if ($env:REFACTORPILOT_TOOLCHAIN_ROOT) { $env:REFACTORPILOT_TOOLCHAIN_ROOT } else { Join-Path $Root "upstream-go" }
$OutputDir = Join-Path $Root "bin"
$CacheDir = Join-Path $Root ".go-cache"
$Output = Join-Path $OutputDir ($(if ($IsWindowsPlatform) { "refactorpilot-compiler-export.exe" } else { "refactorpilot-compiler-export" }))
$TempDir = Join-Path $Root ".go-tmp"
$VersionFile = Join-Path $Upstream "VERSION"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
if (-not (Test-Path $VersionFile)) {
  Set-Content -Path $VersionFile -Value "devel refactorpilot-fork"
}

$env:GO111MODULE = "off"
$env:GOCACHE = $CacheDir
$env:TEMP = $TempDir
$env:TMP = $TempDir

$GoBinary = $env:GO_BOOTSTRAP_BIN
if (-not $GoBinary) {
  $GoCommand = Get-Command go -ErrorAction SilentlyContinue
  if ($GoCommand) {
    $GoBinary = $GoCommand.Source
  }
}

if (-not $GoBinary) {
  throw "No bootstrap Go toolchain was found. Install Go and add it to PATH, or set GO_BOOTSTRAP_BIN to a go executable."
}

$BootstrapRoot = $env:GOROOT_BOOTSTRAP
if (-not $BootstrapRoot) {
  $BootstrapRoot = Split-Path -Parent (Split-Path -Parent $GoBinary)
}

$HostOs = (& $GoBinary env GOHOSTOS).Trim()
$HostArch = (& $GoBinary env GOHOSTARCH).Trim()
$ToolDir = Join-Path $Upstream ("pkg\tool\{0}_{1}" -f $HostOs, $HostArch)
$CompileTool = Join-Path $ToolDir ($(if ($IsWindowsPlatform) { "compile.exe" } else { "compile" }))
$ForkGo = Join-Path $Upstream ($(if ($IsWindowsPlatform) { "bin\go.exe" } else { "bin/go" }))

Push-Location (Join-Path $Upstream "src")
try {
  if (-not (Test-Path $CompileTool) -or -not (Test-Path $ForkGo)) {
    $env:GOROOT_BOOTSTRAP = $BootstrapRoot
    & cmd /c make.bat
    if ($LASTEXITCODE -ne 0) {
      throw "make.bat failed with exit code $LASTEXITCODE"
    }
  }

  $env:GOROOT = $Upstream
  & $ForkGo build -o $Output cmd/compile/refactorpilotexport
  if ($LASTEXITCODE -ne 0) {
    throw "go build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

Write-Output $Output
