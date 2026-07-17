$ports = 3000..3010
$connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort }
if ($connections) {
    $connections | Select-Object LocalPort,OwningProcess,State | Format-Table -AutoSize
    $processIds = $connections | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
    foreach ($processId in $processIds) {
        $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Output "Stopping PID $($proc.Id) $($proc.ProcessName)"
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Output 'No listening connections found on ports 3000-3010'
}
Start-Sleep -Seconds 1
Get-NetTCPConnection -LocalPort $ports -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,State,OwningProcess | Format-Table -AutoSize
