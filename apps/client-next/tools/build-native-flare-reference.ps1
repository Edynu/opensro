param([Parameter(Mandatory=$true)][string]$CompilerRoot, [string]$LensRoot)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$kit = (Resolve-Path -LiteralPath $CompilerRoot).Path
$compiler = Join-Path $kit 'bin/cl.exe'
foreach ($required in @($compiler, "$kit/include/psdk/windows.h", "$kit/include/dx/d3d9.h", "$kit/lib/dx/d3d9.lib")) {
    if (!(Test-Path -LiteralPath $required)) { throw "Missing portable VC/Platform/DX SDK input: $required" }
}
$savedInclude = $env:INCLUDE
$savedLib = $env:LIB
Push-Location $root
try {
    New-Item -ItemType Directory -Force -Path temp/artifacts | Out-Null
    $env:INCLUDE = "$kit/include;$kit/include/psdk;$kit/include/dx"
    $env:LIB = "$kit/lib;$kit/lib/psdk;$kit/lib/dx"
    & $compiler /nologo /EHsc /W4 /O2 /MT tools/native-flare-reference.cpp /Fotemp/artifacts/native-flare-reference.obj /Fe.artifacts/native-flare-reference.exe /link d3d9.lib d3dx9.lib user32.lib
    if ($LASTEXITCODE -ne 0) { throw 'D3D9 reference compilation failed' }
    $fixtures = if ($LensRoot) { @($false, $true) } else { @($false) }
    foreach ($filtered in $fixtures) {
    $stem = if ($filtered) { 'native-filtered-flare' } else { 'native-flare' }
    $height = 384
    $arguments = @("temp/artifacts/$stem.bgra")
    if ($filtered) { $arguments += (Resolve-Path -LiteralPath $LensRoot).Path }
    $adapter = & ./temp/artifacts/native-flare-reference.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw 'D3D9 reference execution failed' }
    $inputs = @{}
    foreach ($file in @('tools/native-flare-reference.cpp', 'temp/artifacts/native-flare-reference.exe', "temp/artifacts/$stem.bgra", $compiler, "$kit/include/dx/d3d9.h", "$kit/lib/dx/d3d9.lib")) {
        $inputs[$file] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    if ($filtered) {
        foreach ($index in 1..8) {
            $file = Join-Path $LensRoot "lens$index.ddj"
            $inputs[$file] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    [ordered]@{schema='sro-d3d9-flare-reference-v1';capturedAt=[DateTime]::UtcNow.ToString('o');adapter="$adapter";width=512;height=$height;format='BGRA8';scenarios=4;scope='Instruction-derived D3D9 flare chain fixture, not original-client scene capture';sha256=$inputs} |
        ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 "temp/artifacts/$stem-reference.json"
    Write-Output $adapter
    }
} finally {
    $env:INCLUDE = $savedInclude
    $env:LIB = $savedLib
    Pop-Location
}
