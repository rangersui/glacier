<#
.SYNOPSIS
  把 windhawk/*.yaml 里的 Glacier 主题写进 Windhawk 的 mod 设置（注册表），让已安装的 mod 热重载。

.DESCRIPTION
  Windhawk 1.7.x 没有命令行导入设置的功能；它把每个 mod 的设置存在
    HKLM\SOFTWARE\Windhawk\Engine\Mods\<mod id>\Settings
  值名按 "controlStyles[0].target"、"controlStyles[0].styles[1]"、"styleConstants[0]" 这种格式，
  改完再把 <mod id> 键下的 SettingsChangeTime（DWORD）换个数，引擎就会通知 mod 重新读设置。
  这个脚本做的就是 Windhawk 界面里 "Textual mode → Save settings" 做的事。

  前提：对应的 mod 已经在 Windhawk 里点过 Install（脚本只写设置，不会装 mod）。
  写 HKLM 需要管理员：请在"以管理员身份运行"的 PowerShell 里执行，或加 -DryRun 只看不写。

.EXAMPLE
  # 预览会写什么（不需要管理员）
  .\apply-glacier.ps1 -DryRun

  # 真正套用全部主题（管理员 PowerShell）
  .\apply-glacier.ps1

  # 只套用任务栏
  .\apply-glacier.ps1 -Only windows-11-taskbar-styler

.NOTES
  撤销：在 Windhawk 里把 mod 关掉（Disable）或卸载即可；或者重新粘贴官方主题。
  回退上一版：每个 mod 键下留有 Settings.glacier-backup（上一次套用前的设置）。
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string[]]$Only,
  # 测试用：写到 HKCU 而不是 HKLM（Windhawk 不会读它）
  [string]$Hive = 'HKLM'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# 文件名 → mod id
$files = [ordered]@{
  '01-taskbar-styler.yaml'             = 'windows-11-taskbar-styler'
  '02-start-menu-styler.yaml'          = 'windows-11-start-menu-styler'
  '03-notification-center-styler.yaml' = 'windows-11-notification-center-styler'
  '04-translucent-windows.yaml'        = 'translucent-windows'
  '05-file-explorer-styler.yaml'       = 'windows-11-file-explorer-styler'
}

# ---------- 一个够用的 YAML 子集解析器（映射 / 列表 / 标量，两空格缩进） ----------
function Parse-YamlSubset([string[]]$lines) {
  $items = @()
  foreach ($raw in $lines) {
    $line = $raw -replace "`r$", ''
    if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
    $indent = ($line -replace '^(\s*).*$', '$1').Length
    $items += [pscustomobject]@{ Indent = $indent; Text = $line.TrimStart() }
  }
  $script:pos = 0
  return (Parse-Block $items 0)
}

function Parse-Scalar([string]$s) {
  $s = $s.Trim()
  if ($s -match '^"(.*)"$') { return [string]$Matches[1] }
  if ($s -match "^'(.*)'$") { return [string]$Matches[1] }
  if ($s -eq 'true')  { return 1 }
  if ($s -eq 'false') { return 0 }
  if ($s -match '^-?\d+$') { return [int]$s }
  return [string]$s
}

function Parse-Block($items, [int]$indent) {
  if ($script:pos -ge $items.Count) { return $null }
  $first = $items[$script:pos]
  if ($first.Text -like '- *' -or $first.Text -eq '-') { $l = Parse-List $items $indent; return ,$l }
  return (Parse-Map $items $indent)
}

function Parse-Map($items, [int]$indent) {
  $map = [ordered]@{}
  while ($script:pos -lt $items.Count) {
    $it = $items[$script:pos]
    if ($it.Indent -lt $indent) { break }
    if ($it.Indent -gt $indent) { throw "缩进错误: $($it.Text)" }
    if ($it.Text -like '- *') { break }
    # 只有"冒号后面跟空格或行尾"才是 key: value；"Fill:=$x" 这种是样式字符串
    if ($it.Text -notmatch '^([^:\s][^:]*):(?:\s+(.*)|\s*)$') { throw "不是 key: value: $($it.Text)" }
    $key = $Matches[1].Trim(); $rest = if ($Matches.ContainsKey(2)) { $Matches[2] } else { '' }
    $script:pos++
    if ($rest -ne '') { $map[$key] = Parse-Scalar $rest; continue }
    # 嵌套块
    if ($script:pos -lt $items.Count -and $items[$script:pos].Indent -gt $indent) {
      $map[$key] = Parse-Block $items $items[$script:pos].Indent
    } elseif ($script:pos -lt $items.Count -and $items[$script:pos].Indent -eq $indent -and $items[$script:pos].Text -like '- *') {
      # 列表项和 key 同缩进（YAML 允许）
      $map[$key] = Parse-List $items $indent
    } else {
      $map[$key] = ''
    }
  }
  return $map
}

function Parse-List($items, [int]$indent) {
  $list = @()
  while ($script:pos -lt $items.Count) {
    $it = $items[$script:pos]
    if ($it.Indent -ne $indent -or -not ($it.Text -like '- *' -or $it.Text -eq '-')) { break }
    $body = $it.Text.Substring(1).TrimStart()
    $script:pos++
    if ($body -match '^([A-Za-z_][\w.-]*):(?:\s+(.*)|\s*)$') {
      # "- key: value" 开头的对象：把这一行当成缩进 indent+2 的 map 第一行
      $childIndent = $indent + 2
      $obj = [ordered]@{}
      $obj[$Matches[1]] = Parse-Scalar $(if ($Matches.ContainsKey(2)) { $Matches[2] } else { '' })
      if ($script:pos -lt $items.Count -and $items[$script:pos].Indent -eq $childIndent -and $items[$script:pos].Text -notlike '- *') {
        $more = Parse-Map $items $childIndent
        foreach ($k in $more.Keys) { $obj[$k] = $more[$k] }
      }
      $list += ,$obj
    } else {
      $list += ,(Parse-Scalar $body)
    }
  }
  # 前面的逗号防止 PowerShell 把单元素数组拆成标量
  return ,$list
}

# ---------- 展平成 Windhawk 的值名 ----------
function Flatten($node, [string]$prefix, $out) {
  if ($node -is [System.Collections.IDictionary]) {
    foreach ($k in $node.Keys) {
      $name = if ($prefix) { "$prefix.$k" } else { "$k" }
      Flatten $node[$k] $name $out
    }
  } elseif ($node -is [array]) {
    for ($i = 0; $i -lt $node.Count; $i++) { Flatten $node[$i] "$prefix[$i]" $out }
  } else {
    $out[$prefix] = $node
  }
}

# ---------- 主流程 ----------
$base = "$Hive`:\SOFTWARE\Windhawk\Engine\Mods"
$anyWritten = $false
foreach ($file in $files.Keys) {
  $modId = $files[$file]
  if ($Only -and ($Only -notcontains $modId)) { continue }
  $path = Join-Path $here $file
  if (-not (Test-Path $path)) { Write-Warning "缺文件 $file，跳过"; continue }

  $tree = Parse-YamlSubset (Get-Content -Path $path -Encoding UTF8)
  $values = [ordered]@{}
  Flatten $tree '' $values

  $modKey = Join-Path $base $modId
  $settingsKey = Join-Path $modKey 'Settings'
  Write-Host "== $modId  ($file, $($values.Count) 个值)" -ForegroundColor Cyan

  if (-not (Test-Path $modKey)) {
    Write-Warning "  Windhawk 里还没装这个 mod（没有 $modKey）。先在 Windhawk 的 Explore 里搜 '$modId' 点 Install，再跑这个脚本。"
    if (-not $DryRun) { continue }
  }

  if (-not $DryRun -and $modId -in @('windows-11-taskbar-styler','windows-11-file-explorer-styler')) {
    $openWindows = @(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    if ($openWindows.Count -gt 0) {
      Write-Warning "  有 $($openWindows.Count) 个资源管理器窗口开着：给 $modId 热套用时它们可能被重启一次（新增 target 时尤其会）。要紧的东西先保存。"
    }
  }

  if ($DryRun) {
    foreach ($k in $values.Keys) {
      $v = $values[$k]; $t = if ($v -is [int]) { 'DWORD' } else { 'SZ' }
      Write-Host ("  {0,-6} {1} = {2}" -f $t, $k, $v)
    }
    continue
  }

  # 先把新设置完整写进一个临时键，写成功了再和正式键换名；中途失败只删临时键，旧设置原封不动。
  # （列表靠"下一个下标不存在"来结束，所以正式键必须整体替换，不能逐条覆盖，否则旧的残留会串进来。）
  $stagingKey = Join-Path $modKey 'Settings.glacier-staging'
  $backupKey  = Join-Path $modKey 'Settings.glacier-backup'
  if (Test-Path $stagingKey) { Remove-Item -Path $stagingKey -Recurse -Force }
  New-Item -Path $stagingKey -Force | Out-Null
  try {
    foreach ($k in $values.Keys) {
      $v = $values[$k]
      if ($v -is [int]) { New-ItemProperty -Path $stagingKey -Name $k -Value $v -PropertyType DWord -Force | Out-Null }
      else              { New-ItemProperty -Path $stagingKey -Name $k -Value ([string]$v) -PropertyType String -Force | Out-Null }
    }
  } catch {
    Remove-Item -Path $stagingKey -Recurse -Force -ErrorAction SilentlyContinue
    throw "  写 $modId 的设置失败，旧设置没动：$($_.Exception.Message)"
  }
  # 注册表提供程序对键的 Rename-Item 不可靠（HKLM 下会报 "Requested registry access is not allowed"），
  # 所以不换名：把旧 Settings 的值逐条抄到 backup，再清空 Settings 逐条写入；写坏了就从 backup 抄回来。
  function Copy-RegValues([string]$from, [string]$to) {
    if (Test-Path $to) { Remove-Item -Path $to -Recurse -Force }
    New-Item -Path $to -Force | Out-Null
    if (-not (Test-Path $from)) { return }
    $src = Get-Item -Path $from
    foreach ($name in $src.GetValueNames()) {
      $kind = $src.GetValueKind($name)
      New-ItemProperty -Path $to -Name $name -Value $src.GetValue($name, $null, 'DoNotExpandEnvironmentNames') -PropertyType $kind -Force | Out-Null
    }
  }
  Copy-RegValues $settingsKey $backupKey
  try {
    Copy-RegValues $stagingKey $settingsKey
  } catch {
    Copy-RegValues $backupKey $settingsKey
    Remove-Item -Path $stagingKey -Recurse -Force -ErrorAction SilentlyContinue
    throw "  写 $modId 的设置失败，已从 backup 恢复旧设置：$($_.Exception.Message)"
  }
  Remove-Item -Path $stagingKey -Recurse -Force -ErrorAction SilentlyContinue
  # 上一版留在 Settings.glacier-backup 里，想回退：把 backup 的值抄回 Settings（或在 Windhawk 界面重新 Save），再改 SettingsChangeTime
  $stamp = [int][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  New-ItemProperty -Path $modKey -Name 'SettingsChangeTime' -Value $stamp -PropertyType DWord -Force | Out-Null
  Write-Host "  已写入，SettingsChangeTime=$stamp（mod 会自动重载）" -ForegroundColor Green
  $anyWritten = $true
}

if ($anyWritten) {
  Write-Host "`n完成。任务栏 / 开始菜单几秒内就会换样子；没变的话在 Windhawk 里把对应 mod 关了再开。" -ForegroundColor Green
}
