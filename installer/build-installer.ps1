$ErrorActionPreference='Stop'
$workspaceRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $workspaceRoot
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /target:winexe /optimize+ /out:installer\LiveLocalTranslator.Host.exe /reference:System.Web.Extensions.dll installer\Host.cs installer\Downloads.cs installer\ModelFiles.cs
if($LASTEXITCODE -ne 0){throw 'Native host compilation failed'}
& $compiler /nologo /target:winexe /optimize+ /out:installer\LiveLocalTranslator.exe /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll installer\Setup.cs
if($LASTEXITCODE -ne 0){throw 'Manager compilation failed'}
Copy-Item -LiteralPath 'installer\LiveLocalTranslator.exe' -Destination 'installer\Uninstall.exe' -Force
$stage=Join-Path $workspaceRoot 'installer\stage'
New-Item -ItemType Directory -Path $stage,(Join-Path $stage 'extension'),(Join-Path $stage 'host'),(Join-Path $stage 'docs') -Force | Out-Null
# Copy the content again for repeated builds: avoid a nested extension/dist folder.
Copy-Item -Path 'dist\*' -Destination (Join-Path $stage 'extension') -Recurse -Force
Copy-Item -LiteralPath 'installer\LiveLocalTranslator.Host.exe' -Destination (Join-Path $stage 'host') -Force
Copy-Item -LiteralPath 'public\model-catalog.json' -Destination (Join-Path $stage 'host') -Force
Copy-Item -LiteralPath 'installer\LiveLocalTranslator.exe','installer\Uninstall.exe' -Destination $stage -Force
Copy-Item -LiteralPath 'installer\extension-id.txt' -Destination (Join-Path $stage 'docs') -Force
Copy-Item -LiteralPath 'YOUTUBE.zh-TW.md' -Destination (Join-Path $stage 'docs') -Force
Copy-Item -LiteralPath 'POWER.zh-TW.md' -Destination (Join-Path $stage 'docs') -Force
Copy-Item -LiteralPath 'public\model-guide.html' -Destination (Join-Path $stage 'docs') -Force
Copy-Item -LiteralPath 'public\style.css' -Destination (Join-Path $stage 'docs') -Force
Copy-Item -LiteralPath 'installer\install-guide.html' -Destination (Join-Path $stage 'docs') -Force
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath 'installer\payload.zip' -CompressionLevel Optimal -Force
$version=(Get-Content -LiteralPath 'public\manifest.json' -Raw -Encoding UTF8 | ConvertFrom-Json).version_name
$release=Join-Path $workspaceRoot ('..\releases\'+$version)
New-Item -ItemType Directory -Path $release -Force | Out-Null
& $compiler /nologo /target:winexe /optimize+ ('/out:'+(Join-Path $release ('LiveLocalTranslator-Setup-'+$version+'.exe'))) /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /resource:installer\payload.zip,payload.zip installer\Setup.cs
if($LASTEXITCODE -ne 0){throw 'Installer compilation failed'}
Get-FileHash -LiteralPath (Join-Path $release ('LiveLocalTranslator-Setup-'+$version+'.exe')) -Algorithm SHA256 | ForEach-Object {($_.Hash.ToLower()+'  LiveLocalTranslator-Setup-'+$version+'.exe')} | Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt')
Write-Output ('Built installer: '+$release)
