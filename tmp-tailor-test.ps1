$body = '{"cv":"test","jobDescription":"test"}'
try {
    $r = Invoke-RestMethod -Uri 'http://localhost:3002/api/tailor-cv' -Method Post -ContentType 'application/json' -Body $body -ErrorAction Stop
    Write-Output "STATUS 200"
    Write-Output 'BODY'
    Write-Output ($r | ConvertTo-Json -Depth 5)
} catch {
    Write-Output "ERROR $($_.Exception.Message)"
    if ($_.Exception.Response -ne $null) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        Write-Output 'RESPONSE BODY:'
        Write-Output $reader.ReadToEnd()
    }
}
