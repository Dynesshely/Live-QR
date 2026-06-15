$harborHost = "registry.services.nimatattic.net"
$imageName = "chaoxing-suite-qr-live"
$project = "third-party"

Write-Output ">>> Tagging image $imageName`:latest as $harborHost/$project/$imageName`:latest ..."
docker tag "$imageName`:latest" "$harborHost/$project/$imageName`:latest"

Write-Output ">>> Pushing image $harborHost/$project/$imageName`:latest ..."
docker push "$harborHost/$project/$imageName`:latest"
