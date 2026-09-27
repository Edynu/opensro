param([Parameter(Mandatory=$true)][string]$CompilerRoot)
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
    & $compiler /nologo /EHsc /W4 /O2 /MT tools/native-alpha-reference.cpp /Fotemp/artifacts/native-alpha-reference.obj /Fe.artifacts/native-alpha-reference.exe /link d3d9.lib user32.lib
    if ($LASTEXITCODE -ne 0) { throw 'D3D9 reference compilation failed' }
    foreach ($sweep in @($false, $true)) {
    $stem = if ($sweep) { 'native-alpha-sweep' } else { 'native-alpha' }
    $height = if ($sweep) { 3072 } else { 12 }
    $arguments = @("temp/artifacts/$stem.bgra")
    if ($sweep) { $arguments += '--sweep' }
    $adapter = & ./temp/artifacts/native-alpha-reference.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw 'D3D9 reference execution failed' }
    $inputs = @{}
    foreach ($file in @('tools/native-alpha-reference.cpp', 'temp/artifacts/native-alpha-reference.exe', "temp/artifacts/$stem.bgra", $compiler, "$kit/include/dx/d3d9.h", "$kit/lib/dx/d3d9.lib")) {
        $inputs[$file] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    [ordered]@{schema='sro-d3d9-alpha-reference-v1';capturedAt=[DateTime]::UtcNow.ToString('o');adapter="$adapter";width=512;height=$height;format='BGRA8';scope='Instruction-derived D3D9 state fixture, not original-client scene capture';sha256=$inputs} |
        ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 "temp/artifacts/$stem-reference.json"
    Write-Output $adapter
    }
} finally {
    $env:INCLUDE = $savedInclude
    $env:LIB = $savedLib
    Pop-Location
}
