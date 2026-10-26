$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$testRoot=Join-Path $projectRoot '.installer-test\app'
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'public\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version_name
$setup=Join-Path $projectRoot ('..\releases\'+$version+'\LiveLocalTranslator-Setup-'+$version+'.exe')
function Install-Test { $p=Start-Process -FilePath $setup -ArgumentList @('--silent','--no-register','--root',('"'+$testRoot+'"')) -WindowStyle Hidden -PassThru -Wait;if($p.ExitCode -ne 0){throw 'Install failed'} }
Install-Test
$manifest=Join-Path $testRoot 'extension\manifest.json'
$before=(Get-FileHash -LiteralPath $manifest).Hash
$model=Join-Path $testRoot 'models\whisper\test-preserved.txt'
$data=Join-Path $testRoot 'data\test-preserved.txt'
Set-Content -LiteralPath $model -Value 'model preserved'
Set-Content -LiteralPath $data -Value 'data preserved'
$modelHash=(Get-FileHash -LiteralPath $model).Hash
Install-Test
if((Get-FileHash -LiteralPath $model).Hash -ne $modelHash){throw 'Upgrade modified model'}
if((Get-FileHash -LiteralPath $manifest).Hash -ne $before){throw 'Upgrade changed manifest identity'}
if(Test-Path -LiteralPath (Join-Path $testRoot 'extension\dist')){throw 'Nested extension folder in installer'}
$p=Start-Process -FilePath (Join-Path $testRoot 'Uninstall.exe') -ArgumentList @('--uninstall','--silent','--keep-models','--no-register','--root',('"'+$testRoot+'"')) -WindowStyle Hidden -PassThru -Wait
$until=(Get-Date).AddSeconds(15)
while((Test-Path -LiteralPath $manifest) -and (Get-Date) -lt $until){Start-Sleep -Milliseconds 250}
if(Test-Path -LiteralPath $manifest){throw 'Uninstall did not remove extension'}
if(!(Test-Path -LiteralPath $model) -or !(Test-Path -LiteralPath $data)){throw 'Uninstall did not preserve models/data'}
@{passed=$true;date=(Get-Date).ToString('o');root=$testRoot;checks=@('install','stable upgrade','preserve models/data','no nested extension/dist','self-copy uninstaller','keep models/data')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'verification\installer-smoke.json')
Write-Output 'Installer upgrade/uninstall smoke passed'
