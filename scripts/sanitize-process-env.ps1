# //TR: Bu helper Control Tower gibi doğrudan Node/npm/Electron başlatan PowerShell entrypoint'lerinde host process-control injection değişkenlerini child process oluşmadan önce temizler.
$deny = @(
  "NODE_OPTIONS","NODE_PATH","NPM_CONFIG_USERCONFIG","NPM_CONFIG_PREFIX",
  "GIT_CONFIG_GLOBAL","GIT_CONFIG_SYSTEM","GIT_CONFIG_COUNT","GIT_SSH_COMMAND","GIT_ASKPASS","SSH_ASKPASS",
  "BASH_ENV","ENV","PROMPT_COMMAND","ELECTRON_RUN_AS_NODE"
)
foreach($name in $deny){ Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
Get-ChildItem Env: | Where-Object { $_.Name -match '^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+)$' } | ForEach-Object { Remove-Item "Env:$($_.Name)" -ErrorAction SilentlyContinue }
