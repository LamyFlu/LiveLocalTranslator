param([Parameter(Mandatory=$true)][ValidateSet('install','cleanup')][string]$Mode,[Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][ValidatePattern('^com\.livelocaltranslator\.test\.[a-f0-9]{16}$')][string]$NativeName)
$ErrorActionPreference='Stop'
$projectRoot=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$fixtureBase=[System.IO.Path]::GetFullPath((Join-Path $projectRoot '.installer-test'))+[System.IO.Path]::DirectorySeparatorChar
$fixtureRoot=[System.IO.Path]::GetFullPath($Root)
if(!$fixtureRoot.StartsWith($fixtureBase,[System.StringComparison]::OrdinalIgnoreCase)){throw 'Test installation escapes fixture directory'}
$key='HKCU:\Software\Google\Chrome\NativeMessagingHosts\'+$NativeName
$manifestPath=Join-Path $fixtureRoot 'host\native-host.json'
if($Mode -eq 'cleanup'){
 if(Test-Path -LiteralPath $key){$registered=(Get-Item -LiteralPath $key).GetValue('');if($registered -ne $manifestPath){throw 'Refusing to remove another host registration'};Remove-Item -LiteralPath $key -Force}
 exit
}
if((Test-Path -LiteralPath $key) -or (Test-Path -LiteralPath $fixtureRoot)){throw 'Test target already exists'}
$version=(Get-Content -LiteralPath (Join-Path $projectRoot 'public\manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version_name
$setup=Join-Path $projectRoot ('..\releases\'+$version+'\LiveLocalTranslator-Setup-'+$version+'.exe')
$result=Start-Process -FilePath $setup -ArgumentList @('--silent','--no-register','--root',('"'+$fixtureRoot+'"')) -WindowStyle Hidden -Wait -PassThru
if($result.ExitCode -ne 0){throw 'Fixture install failed'}
$manifest=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest.name=$NativeName
[System.IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 10),[System.Text.UTF8Encoding]::new($false))
$background=Join-Path $fixtureRoot 'extension\background.js'
$source=[System.IO.File]::ReadAllText($background).Replace('com.livelocaltranslator.files',$NativeName)
[System.IO.File]::WriteAllText($background,$source,[System.Text.UTF8Encoding]::new($false))
New-Item -Path $key -Force | Out-Null
Set-Item -LiteralPath $key -Value $manifestPath
Write-Output ('Isolated native host registered: '+$NativeName)
