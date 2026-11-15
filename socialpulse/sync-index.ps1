$ErrorActionPreference = 'Stop'
$html = Get-Content -Raw dist/index.html
$newJs = 'index-DSs3s4Ot.js'
$updated = $html -replace '/assets/index-xGcdNmgm.js', "/assets/$newJs"
Set-Content -Path dist/index.html -Value $updated -NoNewline -Encoding utf8
Write-Host "Updated index.html -> /assets/$newJs"
