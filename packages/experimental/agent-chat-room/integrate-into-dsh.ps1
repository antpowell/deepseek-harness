#Requires -Version 7.2
<#
.SYNOPSIS
  Copy this plugin into the DeepSeek Harness monorepo and wire it into the web bundle.

.DESCRIPTION
  This script copies the plugin sources to packages/experimental/agent-chat-room,
  adds the TypeScript project reference, the web-app package dependency, and the
  cordis.patch.yml plugin row. Review the changes before running pnpm install/build.

.PARAMETER DshCheckout
  Absolute path to the DeepSeek Harness checkout. Defaults to C:\Engineering\LLM\projects\deepseek-harness.
#>
param(
  [string]$DshCheckout = 'C:\Engineering\LLM\projects\deepseek-harness'
)

$ErrorActionPreference = 'Stop'
$pluginName = '@deepseek-ai/dsh-agent-chat-room'
$packageDir = 'packages/experimental/agent-chat-room'
$destination = Join-Path $DshCheckout $packageDir

# 1. Copy sources
if (Test-Path $destination) {
  Remove-Item -Recurse -Force $destination
}
Copy-Item -Recurse -Path $PSScriptRoot -Destination $destination
Write-Host "Copied plugin to $destination"

# 2. Add TypeScript project reference
$tsconfigClient = Join-Path $DshCheckout 'tsconfig.client.json'
$tsconfig = Get-Content $tsconfigClient -Raw | ConvertFrom-Json
$reference = @{ path = "./$packageDir" }
$existing = $tsconfig.references | Where-Object { $_.path -eq $reference.path }
if (-not $existing) {
  $tsconfig.references += $reference
  $tsconfig | ConvertTo-Json -Depth 10 | Set-Content $tsconfigClient
  Write-Host "Added TypeScript reference in tsconfig.client.json"
}

# 3. Add web-app dependency
$webAppPackage = Join-Path $DshCheckout 'packages/bundle/web-app/package.json'
$webApp = Get-Content $webAppPackage -Raw | ConvertFrom-Json
if (-not $webApp.dependencies.$pluginName) {
  $webApp.dependencies | Add-Member -NotePropertyName $pluginName -NotePropertyValue 'workspace:*'
  $webApp | ConvertTo-Json -Depth 10 | Set-Content $webAppPackage
  Write-Host "Added dependency in packages/bundle/web-app/package.json"
}

# 4. Add cordis.patch.yml row
$patchFile = Join-Path $DshCheckout 'packages/bundle/web-app/cordis.patch.yml'
$content = Get-Content $patchFile -Raw
if ($content -notmatch [regex]::Escape($pluginName)) {
  $content.TrimEnd() + "`n- name: '$pluginName'" | Set-Content $patchFile
  Write-Host "Added plugin row in packages/bundle/web-app/cordis.patch.yml"
}

Write-Host @"

Integration complete. Next steps from the DSH checkout root:

  pnpm install
  pnpm --filter $pluginName bundle
  pnpm run build

Then add the plugin to your profile's cordis.patch.yml if it is not already inherited from web-app.
"@
