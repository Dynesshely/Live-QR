$dttag = $(Get-Date -Format "yyyy-MMdd-HHmm").ToString()
docker build -t chaoxing-suite-qr-live:$($dttag) .
docker tag chaoxing-suite-qr-live:$($dttag) chaoxing-suite-qr-live:latest
