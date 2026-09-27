param([Parameter(Mandatory=$true)][string]$CompilerRoot)
$ErrorActionPreference='Stop'
$kit=(Resolve-Path -LiteralPath $CompilerRoot).Path
$savedInclude=$env:INCLUDE
$savedLib=$env:LIB
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
 $env:INCLUDE="$kit/include;$kit/include/psdk;$kit/include/dx"
 $env:LIB="$kit/lib;$kit/lib/psdk;$kit/lib/dx"
 & "$kit/bin/cl.exe" /nologo /EHsc /O2 /MT tools/native-lens-resources.cpp /Fotemp/artifacts/native-lens-resources.obj /Fe.artifacts/native-lens-resources.exe /link d3d9.lib d3dx9.lib user32.lib
 if($LASTEXITCODE -ne 0){throw 'Texture compiler build failed'}
 & ./temp/artifacts/native-lens-resources.exe '../../../extracted/Map_extracted/sun' '../../assets/images/Map_extracted/sun'
 if($LASTEXITCODE -ne 0){throw 'Texture resource compilation failed'}
 $hashes=@{}
 $files=@('tools/native-lens-resources.cpp','temp/artifacts/native-lens-resources.exe',"$kit/bin/cl.exe","$kit/lib/dx/d3dx9.lib")
 foreach($i in 1..8){$files+="../../../extracted/Map_extracted/sun/lens$i.ddj";$files+="../../assets/images/Map_extracted/sun/lens$i.texture"}
 foreach($file in $files){$hashes[$file]=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()}
 [ordered]@{schema='sro-native-texture-publication-v1';scope='SDK D3DX texture resources, not framebuffer samples or proof of retail static D3DX equivalence';sha256=$hashes}|ConvertTo-Json -Depth 5|Set-Content -Encoding UTF8 docs/evidence/native-lens-resources.json
} finally {$env:INCLUDE=$savedInclude;$env:LIB=$savedLib;Pop-Location}
